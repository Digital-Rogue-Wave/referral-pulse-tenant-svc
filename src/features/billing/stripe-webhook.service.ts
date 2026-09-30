import { HttpStatus, Injectable } from '@nestjs/common';
import type Stripe from 'stripe';
import type { Billing, Prisma } from '@prisma-gen/generated/client';

import { DatabaseService } from '@app/database/database.service';
import { BillingPlanEnum, PaymentStatusEnum, SubscriptionStatusEnum } from '@common/enums/billing.enum';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import {
    BillingEvents,
    PaymentActionRequiredEvent,
    PaymentDisputedEvent,
    PaymentRefundedEvent,
    SubscriptionCancelledEvent,
    SubscriptionChangedEvent,
    SubscriptionCreatedEvent,
    TenantPaymentStatusChangedEvent
} from '@domains/billing';

import { StripeService } from './stripe.service';
import { idOf, invoiceRefs, subscriptionPeriod, toSubscriptionStatus } from './stripe-objects';

type Tx = Prisma.TransactionClient;
type Outcome = 'processed' | 'ignored';

/** What an event needs from Stripe's API, fetched before the transaction opens. */
interface Prepared {
    plan?: BillingPlanEnum | null;
    chargeCustomerId?: string;
}

/**
 * Applies Stripe webhook events to billing state, exactly once and in order.
 *
 * - **Durable dedup:** every event is recorded in `stripe_events`; it is applied in a transaction that locks
 *   its row, so a retry or a concurrent duplicate delivery is acknowledged without being applied twice.
 * - **Atomic:** the state change, its outbox events and the `processed` mark commit together.
 * - **Ordered:** state-changing events move `billings.last_stripe_event_at` with a compare-and-set, so an
 *   older event that arrives late is `ignored` instead of overwriting newer state.
 * - **Retried:** a failure is recorded on the row and rethrown; the 5xx makes Stripe redeliver (up to 3 days).
 */
@Injectable()
export class StripeWebhookService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly stripe: StripeService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly metrics: MetricsService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(StripeWebhookService.name);
    }

    async handle(rawBody: Buffer | string, signature: string): Promise<void> {
        const event = this.verify(rawBody, signature);
        const objectId = (event.data.object as { id?: string }).id ?? null;
        await this.prisma.stripeEvent.createMany({
            data: [{ id: event.id, type: event.type, objectId, stripeCreatedAt: new Date(event.created * 1000) }],
            skipDuplicates: true
        });

        try {
            const prepared = await this.prepare(event);
            const outcome = await this.prisma.$transaction(async (tx) => {
                const [row] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM stripe_events WHERE id = ${event.id} FOR UPDATE`;
                if (row?.status === 'processed' || row?.status === 'ignored') {
                    return 'duplicate' as const;
                }
                const result = await this.apply(tx, event, prepared);
                await tx.stripeEvent.update({
                    where: { id: event.id },
                    data: { status: result, processedAt: new Date(), attempts: { increment: 1 }, lastError: null }
                });
                return result;
            });
            this.count(event.type, outcome);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.prisma.stripeEvent.update({
                where: { id: event.id },
                data: { status: 'failed', attempts: { increment: 1 }, lastError: message.slice(0, 2000) }
            });
            this.count(event.type, 'error');
            this.logger.error(`Stripe event ${event.type} failed; Stripe will redeliver it`, error instanceof Error ? error.stack : undefined, {
                stripeEventId: event.id
            });
            throw error;
        }
    }

    /** A bad signature is the sender's error (400), so Stripe does not keep redelivering it. */
    private verify(rawBody: Buffer | string, signature: string): Stripe.Event {
        try {
            return this.stripe.constructWebhookEvent(rawBody, signature);
        } catch (error) {
            this.count('unknown', 'error');
            this.logger.warn('Rejected a Stripe webhook with an invalid signature', { reason: error instanceof Error ? error.message : 'unknown' });
            throw new BaseException('invalid_request', 'Invalid Stripe signature', HttpStatus.BAD_REQUEST);
        }
    }

    /** Reads from Stripe's API happen here, never while the database transaction holds locks. */
    private async prepare(event: Stripe.Event): Promise<Prepared> {
        switch (event.type) {
            case 'invoice.paid':
            case 'invoice.payment_succeeded': {
                const { subscriptionId } = invoiceRefs(event.data.object);
                if (!subscriptionId) {
                    return {};
                }
                return { plan: this.stripe.resolvePlanFromSubscription(await this.stripe.getSubscription(subscriptionId)) };
            }
            case 'charge.dispute.created':
            case 'charge.dispute.closed': {
                const chargeId = idOf(event.data.object.charge);
                return { chargeCustomerId: chargeId ? await this.stripe.getChargeCustomerId(chargeId) : undefined };
            }
            default:
                return {};
        }
    }

    private async apply(tx: Tx, event: Stripe.Event, prepared: Prepared): Promise<Outcome> {
        switch (event.type) {
            case 'checkout.session.completed':
                return this.onCheckoutCompleted(tx, event, event.data.object);
            case 'invoice.paid':
            case 'invoice.payment_succeeded':
                return this.onInvoicePaid(tx, event, event.data.object, prepared.plan ?? null);
            case 'invoice.payment_failed':
                return this.onInvoicePaymentFailed(tx, event, event.data.object);
            case 'invoice.payment_action_required':
                return this.onPaymentActionRequired(tx, event, event.data.object);
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
                return this.onSubscriptionUpdated(tx, event, event.data.object);
            case 'customer.subscription.deleted':
                return this.onSubscriptionDeleted(tx, event, event.data.object);
            case 'charge.dispute.created':
            case 'charge.dispute.closed':
                return this.onDispute(tx, event, event.data.object, prepared.chargeCustomerId);
            case 'charge.refunded':
                return this.onRefund(tx, event, event.data.object);
            default:
                // `invoice_payment.paid` duplicates `invoice.paid`; everything else is not billing state.
                return 'ignored';
        }
    }

    // ── Subscription lifecycle ──────────────────────────────────────────────

    private async onCheckoutCompleted(tx: Tx, event: Stripe.Event, session: Stripe.Checkout.Session): Promise<Outcome> {
        const tenantId = session.metadata?.tenantId;
        const plan = session.metadata?.planId as BillingPlanEnum | undefined;
        if (!tenantId || !plan) {
            this.logger.warn('checkout.session.completed without tenantId/planId metadata', { stripeEventId: event.id });
            return 'ignored';
        }
        const billing = await tx.billing.upsert({
            where: { tenantId },
            create: { tenantId, plan: BillingPlanEnum.FREE, status: SubscriptionStatusEnum.NONE },
            update: {}
        });
        const paid = plan !== BillingPlanEnum.FREE;
        const subscriptionId = paid ? (idOf(session.subscription) ?? null) : null;
        const customerId = idOf(session.customer) ?? null;
        const paymentIntentId = idOf(session.payment_intent);
        const applied = await this.advance(tx, billing, event, {
            plan,
            status: paid ? SubscriptionStatusEnum.ACTIVE : SubscriptionStatusEnum.NONE,
            stripeSubscriptionId: subscriptionId,
            stripeCustomerId: customerId,
            ...(paymentIntentId ? { stripeTransactionId: paymentIntentId } : {})
        });
        if (!applied) {
            return 'ignored';
        }
        if (paid) {
            await tx.tenant.updateMany({ where: { id: tenantId, trialEndsAt: { gt: new Date() } }, data: { trialEndsAt: new Date() } });
        }
        const isNew = paid && (billing.status !== SubscriptionStatusEnum.ACTIVE || !billing.stripeSubscriptionId);
        if (isNew) {
            this.txEventEmitter.emitAfterCommit(
                BillingEvents.SUBSCRIPTION_CREATED,
                new SubscriptionCreatedEvent(
                    billing.id,
                    tenantId,
                    plan,
                    SubscriptionStatusEnum.ACTIVE,
                    subscriptionId ?? undefined,
                    customerId ?? undefined,
                    undefined,
                    undefined,
                    event.id,
                    session.metadata?.userId
                )
            );
        }
        this.emitChanged(billing, event, plan, paid ? SubscriptionStatusEnum.ACTIVE : SubscriptionStatusEnum.NONE, subscriptionId, customerId);
        return 'processed';
    }

    private async onSubscriptionUpdated(tx: Tx, event: Stripe.Event, subscription: Stripe.Subscription): Promise<Outcome> {
        const customerId = idOf(subscription.customer);
        const billing = await this.findBilling(tx, subscription.id, customerId);
        if (!billing) {
            // Created before checkout completed: checkout.session.completed links the subscription.
            return 'ignored';
        }
        const status = toSubscriptionStatus(subscription.status);
        const plan = this.stripe.resolvePlanFromSubscription(subscription) ?? (billing.plan as BillingPlanEnum);
        const period = subscriptionPeriod(subscription);
        const data: Prisma.BillingUpdateManyMutationInput = {
            status,
            plan,
            stripeSubscriptionId: subscription.id,
            ...(customerId ? { stripeCustomerId: customerId } : {}),
            ...(plan === billing.pendingDowngradePlan ? { pendingDowngradePlan: null, downgradeScheduledAt: null } : {}),
            ...this.cancellationFields(billing, subscription, period.end)
        };
        if (!(await this.advance(tx, billing, event, data))) {
            return 'ignored';
        }
        if (status === SubscriptionStatusEnum.PAST_DUE) {
            await this.setPaymentStatus(tx, billing, PaymentStatusEnum.PAST_DUE, [PaymentStatusEnum.ACTIVE], {
                stripeSubscriptionId: subscription.id
            });
        }
        if (plan !== billing.plan || status !== billing.status) {
            this.emitChanged(billing, event, plan, status, subscription.id, customerId ?? null, period.start, period.end);
        }
        return 'processed';
    }

    /** Cancellation scheduled or withdrawn in Stripe (dashboard, portal or API) is mirrored here. */
    private cancellationFields(
        billing: Billing,
        subscription: Stripe.Subscription,
        periodEnd: Date | undefined
    ): Prisma.BillingUpdateManyMutationInput {
        if (subscription.cancel_at_period_end) {
            return { cancellationRequestedAt: billing.cancellationRequestedAt ?? new Date(), cancellationEffectiveAt: periodEnd ?? null };
        }
        if (billing.cancellationRequestedAt && subscription.status !== 'canceled') {
            return { cancellationRequestedAt: null, cancellationEffectiveAt: null, cancellationReason: null };
        }
        return {};
    }

    /**
     * The subscription ended. The plan drops to Free, not only the status: limits resolve from the plan, so
     * leaving the paid plan in place kept a cancelled tenant on paid entitlements.
     */
    private async onSubscriptionDeleted(tx: Tx, event: Stripe.Event, subscription: Stripe.Subscription): Promise<Outcome> {
        const billing = await tx.billing.findFirst({ where: { stripeSubscriptionId: subscription.id } });
        if (!billing) {
            return 'ignored';
        }
        const endedAt = subscription.ended_at ? new Date(subscription.ended_at * 1000) : new Date();
        const effectiveAt = billing.cancellationEffectiveAt ?? endedAt;
        const applied = await this.advance(tx, billing, event, {
            plan: BillingPlanEnum.FREE,
            status: SubscriptionStatusEnum.CANCELED,
            cancellationEffectiveAt: effectiveAt,
            stripeSubscriptionId: null
        });
        if (!applied) {
            return 'ignored';
        }
        this.txEventEmitter.emitAfterCommit(
            BillingEvents.SUBSCRIPTION_CANCELLED,
            new SubscriptionCancelledEvent(
                billing.id,
                billing.tenantId,
                endedAt.toISOString(),
                effectiveAt.toISOString(),
                subscription.id,
                BillingPlanEnum.FREE,
                'stripe_subscription_deleted'
            )
        );
        return 'processed';
    }

    // ── Invoices and payments ───────────────────────────────────────────────

    private async onInvoicePaid(tx: Tx, event: Stripe.Event, invoice: Stripe.Invoice, plan: BillingPlanEnum | null): Promise<Outcome> {
        const refs = invoiceRefs(invoice);
        const billing = refs.subscriptionId ? await tx.billing.findFirst({ where: { stripeSubscriptionId: refs.subscriptionId } }) : null;
        if (!billing) {
            return 'ignored';
        }
        const planChanged = !!plan && plan !== billing.plan;
        const applied = await this.advance(tx, billing, event, {
            ...(refs.paymentIntentId ? { stripeTransactionId: refs.paymentIntentId } : {}),
            ...(planChanged ? { plan } : {}),
            ...(planChanged && plan === billing.pendingDowngradePlan ? { pendingDowngradePlan: null, downgradeScheduledAt: null } : {})
        });
        if (!applied) {
            return 'ignored';
        }
        await this.setPaymentStatus(tx, billing, PaymentStatusEnum.ACTIVE, null, {
            stripeSubscriptionId: refs.subscriptionId,
            stripeInvoiceId: refs.invoiceId,
            stripePaymentIntentId: refs.paymentIntentId
        });
        if (planChanged) {
            this.emitChanged(billing, event, plan, billing.status, billing.stripeSubscriptionId, billing.stripeCustomerId);
        }
        return 'processed';
    }

    /** First failure moves an active tenant to `past_due`; dunning escalates from there. Never un-escalates. */
    private async onInvoicePaymentFailed(tx: Tx, event: Stripe.Event, invoice: Stripe.Invoice): Promise<Outcome> {
        const refs = invoiceRefs(invoice);
        const billing = await this.findBilling(tx, refs.subscriptionId, refs.customerId);
        if (!billing || !(await this.advance(tx, billing, event, {}))) {
            return 'ignored';
        }
        await this.setPaymentStatus(tx, billing, PaymentStatusEnum.PAST_DUE, [PaymentStatusEnum.ACTIVE], {
            stripeSubscriptionId: refs.subscriptionId,
            stripeInvoiceId: refs.invoiceId,
            stripePaymentIntentId: refs.paymentIntentId,
            nextPaymentAttemptAt: invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000).toISOString() : null
        });
        return 'processed';
    }

    /** SCA: the customer must authenticate the payment; notification-service emails the Owner the link. */
    private async onPaymentActionRequired(tx: Tx, event: Stripe.Event, invoice: Stripe.Invoice): Promise<Outcome> {
        const refs = invoiceRefs(invoice);
        const billing = await this.findBilling(tx, refs.subscriptionId, refs.customerId);
        if (!billing) {
            return 'ignored';
        }
        this.txEventEmitter.emitAfterCommit(
            BillingEvents.PAYMENT_ACTION_REQUIRED,
            new PaymentActionRequiredEvent(
                billing.id,
                billing.tenantId,
                event.id,
                refs.invoiceId,
                invoice.hosted_invoice_url ?? null,
                invoice.amount_due,
                invoice.currency
            )
        );
        return 'processed';
    }

    private async onDispute(tx: Tx, event: Stripe.Event, dispute: Stripe.Dispute, customerId: string | undefined): Promise<Outcome> {
        const billing = customerId ? await tx.billing.findFirst({ where: { stripeCustomerId: customerId } }) : null;
        if (!billing) {
            return 'ignored';
        }
        const phase = event.type === 'charge.dispute.created' ? 'opened' : 'closed';
        this.logger.warn(`Stripe dispute ${phase}`, { tenantId: billing.tenantId, disputeId: dispute.id, status: dispute.status });
        this.txEventEmitter.emitAfterCommit(
            BillingEvents.PAYMENT_DISPUTED,
            new PaymentDisputedEvent(
                billing.id,
                billing.tenantId,
                event.id,
                phase,
                dispute.id,
                idOf(dispute.charge) ?? '',
                dispute.amount,
                dispute.currency,
                dispute.reason,
                dispute.status
            )
        );
        return 'processed';
    }

    private async onRefund(tx: Tx, event: Stripe.Event, charge: Stripe.Charge): Promise<Outcome> {
        const customerId = idOf(charge.customer);
        const billing = customerId ? await tx.billing.findFirst({ where: { stripeCustomerId: customerId } }) : null;
        if (!billing) {
            return 'ignored';
        }
        this.txEventEmitter.emitAfterCommit(
            BillingEvents.PAYMENT_REFUNDED,
            new PaymentRefundedEvent(billing.id, billing.tenantId, event.id, charge.id, charge.amount_refunded, charge.currency, charge.refunded)
        );
        return 'processed';
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Applies `data` only if no newer Stripe event was applied to this billing yet (compare-and-set on
     * `last_stripe_event_at`). Returns false for a stale event.
     */
    private async advance(tx: Tx, billing: Billing, event: Stripe.Event, data: Prisma.BillingUpdateManyMutationInput): Promise<boolean> {
        const at = new Date(event.created * 1000);
        const { count } = await tx.billing.updateMany({
            where: { id: billing.id, OR: [{ lastStripeEventAt: null }, { lastStripeEventAt: { lte: at } }] },
            data: { ...data, lastStripeEventAt: at }
        });
        if (count === 0) {
            this.logger.warn('Ignoring a Stripe event older than the state already applied', { stripeEventId: event.id, type: event.type });
        }
        return count === 1;
    }

    /** Moves the tenant's payment status (compare-and-set), optionally only from the listed statuses. */
    private async setPaymentStatus(
        tx: Tx,
        billing: Billing,
        next: PaymentStatusEnum,
        onlyFrom: PaymentStatusEnum[] | null,
        stripe: { stripeSubscriptionId?: string; stripeInvoiceId?: string; stripePaymentIntentId?: string; nextPaymentAttemptAt?: string | null }
    ): Promise<void> {
        const tenant = await tx.tenant.findUnique({ where: { id: billing.tenantId }, select: { paymentStatus: true } });
        const previous = tenant?.paymentStatus as PaymentStatusEnum | undefined;
        if (!previous || previous === next || (onlyFrom && !onlyFrom.includes(previous))) {
            return;
        }
        const changedAt = new Date();
        const { count } = await tx.tenant.updateMany({
            where: { id: billing.tenantId, paymentStatus: previous },
            data: { paymentStatus: next, paymentStatusChangedAt: changedAt }
        });
        if (count === 0) {
            throw new Error(`Payment status of tenant ${billing.tenantId} changed concurrently`);
        }
        this.txEventEmitter.emitAfterCommit(
            BillingEvents.TENANT_PAYMENT_STATUS_CHANGED,
            new TenantPaymentStatusChangedEvent(
                billing.tenantId,
                billing.tenantId,
                previous,
                next,
                changedAt.toISOString(),
                undefined,
                undefined,
                billing.stripeCustomerId ?? undefined,
                stripe.stripeSubscriptionId,
                stripe.stripeInvoiceId,
                stripe.stripePaymentIntentId,
                stripe.nextPaymentAttemptAt ?? null
            )
        );
    }

    private async findBilling(tx: Tx, subscriptionId: string | undefined, customerId: string | undefined): Promise<Billing | null> {
        const bySubscription = subscriptionId ? await tx.billing.findFirst({ where: { stripeSubscriptionId: subscriptionId } }) : null;
        if (bySubscription || !customerId) {
            return bySubscription;
        }
        return tx.billing.findFirst({ where: { stripeCustomerId: customerId } });
    }

    private emitChanged(
        billing: Billing,
        event: Stripe.Event,
        plan: string,
        status: string,
        subscriptionId: string | null,
        customerId: string | null,
        periodStart?: Date,
        periodEnd?: Date
    ): void {
        this.txEventEmitter.emitAfterCommit(
            BillingEvents.SUBSCRIPTION_CHANGED,
            new SubscriptionChangedEvent(
                billing.id,
                billing.tenantId,
                plan,
                status,
                subscriptionId ?? undefined,
                customerId ?? undefined,
                periodStart,
                periodEnd,
                event.id
            )
        );
    }

    private count(type: string, result: 'processed' | 'ignored' | 'duplicate' | 'error'): void {
        this.metrics.createCounter('billing_subscription_events_total').add(1, { event: type, result });
    }
}
