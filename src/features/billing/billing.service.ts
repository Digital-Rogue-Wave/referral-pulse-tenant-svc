import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import Stripe from 'stripe';

import { NO_STRIPE_CUSTOMER_ERROR } from '@app/types';

/**
 * Stripe Invoice runtime fields that exist in API responses but are
 * not part of the official Stripe SDK v20+ types.
 * These fields are still returned by the Stripe API for backwards compatibility.
 */
interface StripeInvoiceRuntimeFields {
    payment_intent?: string | Stripe.PaymentIntent | null;
    subscription?: string | Stripe.Subscription | null;
}

type InvoiceWithRuntimeFields = Stripe.Invoice & StripeInvoiceRuntimeFields;

/**
 * Gets the current period end from a Stripe subscription.
 * In SDK v20+, current_period_end moved to SubscriptionItem level.
 */
function getSubscriptionPeriodEnd(subscription: Stripe.Subscription): number | null {
    const item = subscription.items?.data?.[0];
    return item?.current_period_end ?? null;
}
import type { Billing, Prisma } from '@prisma-gen/generated/client';
import { BillingPlanEnum, SubscriptionStatusEnum, PaymentStatusEnum } from '@common/enums/billing.enum';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { IdempotencyService } from '@common/idempotency/idempotency.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';

import { DateService } from '@common/helper/date.service';

import { TenantService } from '@app/features/tenant/tenant.service';
import { TenantStatsService } from '@app/features/tenant/aware/tenant-stats.service';

import {
    SubscriptionCheckoutResponseDto,
    SubscriptionStatusDto,
    SubscriptionUpgradePreviewResponseDto,
    PaymentMethodSetupResponseDto,
    PaymentMethodDto,
    SubscriptionCancelRequestDto,
    InvoiceDto,
    UpcomingInvoiceDto,
    UsageSummaryDto,
    UsageMetricSummaryDto,
    UsageMetricHistoryPointDto,
    SubscriptionCreatedEvent,
    SubscriptionChangedEvent,
    SubscriptionUpgradedEvent,
    SubscriptionDowngradeScheduledEvent,
    SubscriptionCancelledEvent,
    TenantPaymentStatusChangedEvent,
    BillingEvents
} from '@domains/billing';

import { StripeService } from './stripe.service';
import { PlanLimitService } from './plan-limit.service';

@Injectable()
export class BillingService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly tenantContext: TenantContextService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly stripeService: StripeService,
        private readonly idempotencyService: IdempotencyService,
        private readonly metricsService: MetricsService,
        private readonly tenantService: TenantService,
        private readonly tenantStatsService: TenantStatsService,
        private readonly planLimitService: PlanLimitService,
        private readonly dateService: DateService
    ) {
        this.logger.setContext(BillingService.name);
    }

    private async createBillingForTenant(): Promise<Billing> {
        const tenantId = this.tenantContext.getTenantId()!;
        let billing = await this.prisma.billing.findUnique({
            where: { tenantId }
        });

        if (!billing) {
            billing = await this.prisma.billing.create({
                data: {
                    tenantId,
                    plan: BillingPlanEnum.FREE,
                    status: SubscriptionStatusEnum.NONE
                }
            });
        }

        return billing;
    }

    async getUsageSummary(): Promise<UsageSummaryDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();
        const tenantId = billing.tenantId;

        const limits = await this.planLimitService.getPlanLimits(tenantId);

        const today = this.dateService.nowMoment();
        const todayStr = this.dateService.format(today, 'YYYY-MM-DD');

        const periodDates: string[] = [];
        for (let i = 0; i < 7; i++) {
            const d = this.dateService.subtract(today, i, 'day');
            periodDates.push(this.dateService.format(d, 'YYYY-MM-DD'));
        }

        const rows = await this.prisma.tenantUsage.findMany({
            where: {
                tenantId,
                periodDate: { in: periodDates }
            }
        });

        const metricsMap = new Map<
            string,
            {
                currentUsage: number;
                history: UsageMetricHistoryPointDto[];
            }
        >();

        for (const row of rows) {
            let entry = metricsMap.get(row.metricName);
            if (!entry) {
                entry = {
                    currentUsage: 0,
                    history: []
                };
                metricsMap.set(row.metricName, entry);
            }

            entry.history.push({
                periodDate: row.periodDate,
                usage: row.currentUsage
            });

            if (row.periodDate === todayStr) {
                entry.currentUsage = row.currentUsage;
            }
        }

        const metrics: UsageMetricSummaryDto[] = [];

        for (const [metricName, value] of metricsMap.entries()) {
            const rawLimit = limits ? (limits as Record<string, number | undefined>)[metricName] : undefined;
            const limit: number | null = rawLimit === null || rawLimit === undefined ? null : rawLimit;
            const percentageUsed: number | null = limit !== null && limit > 0 ? Math.min((value.currentUsage / limit) * 100, 100) : null;

            const history = [...value.history].sort((a, b) => a.periodDate.localeCompare(b.periodDate));

            metrics.push({
                metric: metricName,
                currentUsage: value.currentUsage,
                limit,
                percentageUsed,
                history
            });
        }

        metrics.sort((a, b) => a.metric.localeCompare(b.metric));

        return {
            plan: billing.plan as BillingPlanEnum,
            metrics
        };
    }

    private async handleInvoicePaymentSucceeded(event: Stripe.Event): Promise<void> {
        const invoice = event.data.object as Stripe.Invoice;
        const { invoiceId, paymentIntentId, subscriptionId } = this.extractInvoiceIds(invoice);

        if (!subscriptionId) {
            this.logger.warn(`invoice.payment_succeeded missing subscription reference: eventId=${event.id}, invoiceId=${invoiceId}`);
            return;
        }

        const billing = await this.prisma.billing.findFirst({
            where: { stripeSubscriptionId: subscriptionId }
        });

        if (!billing) {
            this.logger.warn(
                `invoice.payment_succeeded: no Billing found for subscriptionId=${subscriptionId}, eventId=${event.id}, invoiceId=${invoiceId}`
            );
            return;
        }

        if (paymentIntentId) {
            await this.prisma.billing.update({
                where: { id: billing.id },
                data: { stripeTransactionId: paymentIntentId }
            });
        }

        await this.restoreTenantPaymentStatus(billing, event, invoiceId, paymentIntentId);
        await this.reconcileBillingPlan(billing, subscriptionId, invoiceId, event);

        this.logger.log(
            `Processed invoice.payment_succeeded from Stripe: eventId=${event.id}, invoiceId=${invoiceId}, subscriptionId=${subscriptionId}, paymentIntentId=${paymentIntentId ?? 'unknown'}`
        );
    }

    private extractInvoiceIds(invoice: Stripe.Invoice): {
        invoiceId: string;
        paymentIntentId: string | undefined;
        subscriptionId: string | undefined;
    } {
        const invoiceWithRuntime = invoice as InvoiceWithRuntimeFields;

        const paymentIntentId =
            typeof invoiceWithRuntime.payment_intent === 'string' ? invoiceWithRuntime.payment_intent : invoiceWithRuntime.payment_intent?.id;

        const subscriptionId =
            typeof invoiceWithRuntime.subscription === 'string' ? invoiceWithRuntime.subscription : invoiceWithRuntime.subscription?.id;

        return { invoiceId: invoice.id, paymentIntentId, subscriptionId };
    }

    private async restoreTenantPaymentStatus(
        billing: Billing,
        event: Stripe.Event,
        invoiceId: string,
        paymentIntentId: string | undefined
    ): Promise<void> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: billing.tenantId }
            });

            if (!tenant) {
                this.logger.warn(
                    `invoice.payment_succeeded: no Tenant found for tenantId=${billing.tenantId}, eventId=${event.id}, invoiceId=${invoiceId}`
                );
                return;
            }

            if (tenant.paymentStatus === PaymentStatusEnum.ACTIVE) {
                return;
            }

            const previousStatus = tenant.paymentStatus;
            const changedAt = new Date();

            await this.prisma.tenant.update({
                where: { id: tenant.id },
                data: {
                    paymentStatus: PaymentStatusEnum.ACTIVE,
                    paymentStatusChangedAt: changedAt
                }
            });

            this.txEventEmitter.emitAfterCommit(
                BillingEvents.TENANT_PAYMENT_STATUS_CHANGED,
                new TenantPaymentStatusChangedEvent(
                    tenant.id,
                    tenant.id,
                    previousStatus,
                    PaymentStatusEnum.ACTIVE,
                    this.dateService.toISO(changedAt),
                    undefined,
                    undefined,
                    billing.stripeCustomerId ?? undefined,
                    billing.stripeSubscriptionId ?? undefined,
                    invoiceId,
                    paymentIntentId ?? undefined,
                    null
                )
            );
        } catch (err) {
            this.logger.error(
                `Failed to update tenant paymentStatus for invoice.payment_succeeded: tenantId=${billing.tenantId}, eventId=${event.id}, invoiceId=${invoiceId}`,
                err instanceof Error ? err.stack : String(err)
            );
        }
    }

    private async reconcileBillingPlan(billing: Billing, subscriptionId: string, invoiceId: string, event: Stripe.Event): Promise<void> {
        try {
            const subscription = await this.stripeService.getSubscription(subscriptionId);
            const resolvedPlan = this.stripeService.resolvePlanFromSubscription(subscription);

            if (!resolvedPlan || resolvedPlan === billing.plan) {
                return;
            }

            const previousPlan = billing.plan;
            const updateData: Prisma.BillingUpdateInput = { plan: resolvedPlan };

            if (billing.pendingDowngradePlan === resolvedPlan) {
                updateData.pendingDowngradePlan = null;
                updateData.downgradeScheduledAt = null;
            }

            await this.prisma.billing.update({
                where: { id: billing.id },
                data: updateData
            });

            this.txEventEmitter.emitAfterCommit(
                BillingEvents.SUBSCRIPTION_CHANGED,
                new SubscriptionChangedEvent(
                    billing.id,
                    billing.tenantId,
                    resolvedPlan,
                    billing.status,
                    billing.stripeSubscriptionId ?? undefined,
                    billing.stripeCustomerId ?? undefined,
                    undefined,
                    undefined,
                    event.id
                )
            );

            this.logger.log(`Subscription plan updated from ${previousPlan} to ${resolvedPlan}`, {
                tenantId: billing.tenantId,
                previousPlan,
                newPlan: resolvedPlan,
                stripeEventId: event.id
            });
        } catch (err) {
            this.logger.error(
                `Failed to reconcile billing plan from Stripe after invoice.payment_succeeded: tenantId=${billing.tenantId}, subscriptionId=${subscriptionId}, invoiceId=${invoiceId}, eventId=${event.id}`,
                err instanceof Error ? err.stack : String(err)
            );
        }
    }

    private async getOrCreateBillingForCurrentTenant(): Promise<Billing> {
        return this.createBillingForTenant();
    }

    async subscriptionCheckout(plan: BillingPlanEnum, couponCode?: string): Promise<SubscriptionCheckoutResponseDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();
        const userId = this.tenantContext.getUserId();

        const session = await this.stripeService.createSubscriptionCheckoutSession({
            tenantId: billing.tenantId,
            plan,
            userId,
            couponCode
        });

        this.logger.log(`Created Stripe Checkout Session ${session.id} via BillingService for tenant ${billing.tenantId}, plan ${plan}`);

        return {
            plan,
            checkoutUrl: session.url ?? undefined,
            sessionId: session.id,
            paymentStatus: PaymentStatusEnum.ACTIVE
        };
    }

    async getCurrentSubscription(): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();
        const tenantId = billing.tenantId;

        let paymentStatus: PaymentStatusEnum = PaymentStatusEnum.ACTIVE;

        let trialActive: boolean | undefined;
        let trialEndsAt: Date | null = null;
        let trialDaysRemaining: number | null = null;

        try {
            const tenant = await this.tenantService.findOneById(tenantId);
            if (tenant?.trialEndsAt) {
                trialEndsAt = tenant.trialEndsAt;
                const now = new Date();
                if (tenant.trialEndsAt > now) {
                    trialActive = true;
                    trialDaysRemaining = Math.ceil(this.dateService.diff(tenant.trialEndsAt, now, 'days'));
                } else {
                    trialActive = false;
                }

                if (tenant.paymentStatus) {
                    paymentStatus = tenant.paymentStatus as PaymentStatusEnum;
                }
            } else {
                trialActive = false;
            }
        } catch (err) {
            this.logger.error(`Failed to load tenant trial info for tenant ${tenantId}`, err instanceof Error ? err.stack : String(err));
        }

        let planUsagePercentage: number | null = null;
        try {
            const stats = await this.tenantStatsService.getStats();
            planUsagePercentage = stats.planUsagePercentage ?? null;
        } catch (err) {
            this.logger.error(`Failed to load usage stats for tenant ${tenantId}`, err instanceof Error ? err.stack : String(err));
        }

        let stripeSubscriptionStatus: string | null = null;
        let stripeCurrentPeriodEnd: string | null = null;
        let stripePeriodDaysRemaining: number | null = null;
        let stripeCancelAtPeriodEnd: boolean | null = null;

        if (billing.stripeSubscriptionId) {
            try {
                const subscription = await this.stripeService.getSubscription(billing.stripeSubscriptionId);
                stripeSubscriptionStatus = subscription.status;

                const currentPeriodEndSeconds = getSubscriptionPeriodEnd(subscription);

                if (currentPeriodEndSeconds !== null) {
                    const endDate = this.dateService.fromUnix(currentPeriodEndSeconds).toDate();
                    stripeCurrentPeriodEnd = this.dateService.toISO(endDate);
                    stripePeriodDaysRemaining = Math.max(0, Math.ceil(this.dateService.diff(endDate, new Date(), 'days')));
                }

                stripeCancelAtPeriodEnd = subscription.cancel_at_period_end;
            } catch (err) {
                this.logger.error(
                    `Failed to fetch Stripe subscription ${billing.stripeSubscriptionId} for tenant ${tenantId}`,
                    err instanceof Error ? err.stack : String(err)
                );
            }
        }

        return {
            plan: billing.plan as BillingPlanEnum,
            subscriptionStatus: billing.status as SubscriptionStatusEnum,
            paymentStatus,
            stripeCustomerId: billing.stripeCustomerId ?? null,
            stripeSubscriptionId: billing.stripeSubscriptionId ?? null,
            stripeTransactionId: billing.stripeTransactionId ?? null,
            trialActive,
            trialEndsAt,
            trialDaysRemaining,
            planUsagePercentage,
            stripeSubscriptionStatus,
            stripeCurrentPeriodEnd,
            stripePeriodDaysRemaining,
            stripeCancelAtPeriodEnd,
            pendingDowngradePlan: (billing.pendingDowngradePlan as BillingPlanEnum | null) ?? null,
            downgradeScheduledAt: billing.downgradeScheduledAt ?? null,
            cancellationReason: billing.cancellationReason ?? null,
            cancellationRequestedAt: billing.cancellationRequestedAt ?? null,
            cancellationEffectiveAt: billing.cancellationEffectiveAt ?? null
        };
    }

    async previewSubscriptionUpgrade(targetPlan: BillingPlanEnum): Promise<SubscriptionUpgradePreviewResponseDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to upgrade for this tenant', HttpStatus.BAD_REQUEST);
        }

        const preview = await this.stripeService.previewSubscriptionUpgrade({
            stripeSubscriptionId: billing.stripeSubscriptionId,
            targetPlan
        });

        return {
            targetPlan,
            amountDueNow: preview.amountDueNow,
            currency: preview.currency,
            nextInvoiceDate: preview.nextInvoiceDate
        };
    }

    async upgradeSubscription(targetPlan: BillingPlanEnum): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to upgrade for this tenant', HttpStatus.BAD_REQUEST);
        }

        const previousPlan = billing.plan;
        const previousStatus = billing.status;
        const userId = this.tenantContext.getUserId();

        await this.stripeService.upgradeSubscription({
            stripeSubscriptionId: billing.stripeSubscriptionId,
            targetPlan
        });

        await this.prisma.billing.update({
            where: { id: billing.id },
            data: {
                plan: targetPlan,
                status: SubscriptionStatusEnum.ACTIVE
            }
        });

        this.txEventEmitter.emitAfterCommit(
            BillingEvents.SUBSCRIPTION_UPGRADED,
            new SubscriptionUpgradedEvent(billing.id, billing.tenantId, previousPlan, targetPlan, this.dateService.nowISO(), userId ?? undefined)
        );

        this.logger.log(`Subscription upgraded from ${previousPlan} to ${targetPlan}`, {
            tenantId: billing.tenantId,
            previousPlan,
            previousStatus,
            newPlan: targetPlan
        });

        return await this.getCurrentSubscription();
    }

    async createPaymentMethodSetupIntent(): Promise<PaymentMethodSetupResponseDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException(NO_STRIPE_CUSTOMER_ERROR, HttpStatus.BAD_REQUEST);
        }

        const setupIntent = await this.stripeService.createSetupIntent(billing.stripeCustomerId);

        if (!setupIntent.client_secret) {
            throw new HttpException('Failed to create Stripe SetupIntent', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        return {
            clientSecret: setupIntent.client_secret,
            customerId: billing.stripeCustomerId
        };
    }

    async listPaymentMethods(): Promise<PaymentMethodDto[]> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException(NO_STRIPE_CUSTOMER_ERROR, HttpStatus.BAD_REQUEST);
        }

        return await this.stripeService.listPaymentMethods(billing.stripeCustomerId);
    }

    async deletePaymentMethod(paymentMethodId: string): Promise<void> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException(NO_STRIPE_CUSTOMER_ERROR, HttpStatus.BAD_REQUEST);
        }

        await this.stripeService.detachPaymentMethodForCustomer(billing.stripeCustomerId, paymentMethodId);
    }

    async setDefaultPaymentMethod(paymentMethodId: string): Promise<void> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException(NO_STRIPE_CUSTOMER_ERROR, HttpStatus.BAD_REQUEST);
        }

        await this.stripeService.setDefaultPaymentMethodForCustomer(billing.stripeCustomerId, paymentMethodId);
    }

    async listInvoices(): Promise<InvoiceDto[]> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException(NO_STRIPE_CUSTOMER_ERROR, HttpStatus.BAD_REQUEST);
        }

        return await this.stripeService.listInvoicesForCustomer(billing.stripeCustomerId);
    }

    async getUpcomingInvoice(): Promise<UpcomingInvoiceDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId || !billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to preview upcoming invoice for this tenant', HttpStatus.BAD_REQUEST);
        }

        return await this.stripeService.retrieveUpcomingInvoiceForCustomer({
            customerId: billing.stripeCustomerId,
            subscriptionId: billing.stripeSubscriptionId
        });
    }

    async cancelSubscription(dto: SubscriptionCancelRequestDto): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to cancel for this tenant', HttpStatus.BAD_REQUEST);
        }

        if (billing.status !== SubscriptionStatusEnum.ACTIVE) {
            throw new HttpException('Only active subscriptions can be cancelled', HttpStatus.BAD_REQUEST);
        }

        const now = new Date();

        if (billing.cancellationRequestedAt && billing.cancellationEffectiveAt && billing.cancellationEffectiveAt > now) {
            throw new HttpException('Subscription cancellation is already scheduled', HttpStatus.BAD_REQUEST);
        }

        const userId = this.tenantContext.getUserId();

        const schedule = await this.stripeService.scheduleSubscriptionCancellation(billing.stripeSubscriptionId);

        await this.prisma.billing.update({
            where: { id: billing.id },
            data: {
                cancellationReason: dto.reason ?? null,
                cancellationRequestedAt: now,
                cancellationEffectiveAt: schedule.effectiveDate ?? null
            }
        });

        this.txEventEmitter.emitAfterCommit(
            BillingEvents.SUBSCRIPTION_CANCELLED,
            new SubscriptionCancelledEvent(
                billing.id,
                billing.tenantId,
                this.dateService.toISO(now),
                schedule.effectiveDate ? this.dateService.toISO(schedule.effectiveDate) : this.dateService.toISO(now),
                billing.stripeSubscriptionId ?? undefined,
                billing.plan,
                dto.reason ?? undefined,
                userId ?? undefined
            )
        );

        this.logger.log(`Subscription cancellation scheduled`, {
            tenantId: billing.tenantId,
            effectiveDate: schedule.effectiveDate,
            reason: dto.reason
        });

        return await this.getCurrentSubscription();
    }

    async reactivateSubscription(): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to reactivate for this tenant', HttpStatus.BAD_REQUEST);
        }

        const now = new Date();

        if (!billing.cancellationRequestedAt || !billing.cancellationEffectiveAt) {
            throw new HttpException('No pending cancellation to reactivate', HttpStatus.BAD_REQUEST);
        }

        if (billing.cancellationEffectiveAt <= now) {
            throw new HttpException('Cancellation is already effective and cannot be reactivated', HttpStatus.BAD_REQUEST);
        }

        await this.stripeService.reactivateSubscription(billing.stripeSubscriptionId);

        await this.prisma.billing.update({
            where: { id: billing.id },
            data: {
                cancellationReason: null,
                cancellationRequestedAt: null,
                cancellationEffectiveAt: null
            }
        });

        this.logger.log(`Subscription cancellation was reactivated`, {
            tenantId: billing.tenantId
        });

        return await this.getCurrentSubscription();
    }

    private async validateDowngradeUsageOrThrow(targetPlan: BillingPlanEnum): Promise<void> {
        const tenantId = this.tenantContext.getTenantId();

        try {
            const stats = await this.tenantStatsService.getStats();
            const usage = stats.planUsagePercentage ?? null;

            this.logger.log(
                `Downgrade usage validation placeholder for tenant ${tenantId}, targetPlan=${targetPlan}, planUsagePercentage=${usage ?? 'unknown'}`
            );
        } catch (err) {
            this.logger.error(
                `Failed to perform downgrade usage validation for tenant ${tenantId} and plan ${targetPlan}`,
                err instanceof Error ? err.stack : String(err)
            );
        }
    }

    async downgradeSubscription(targetPlan: BillingPlanEnum): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to downgrade for this tenant', HttpStatus.BAD_REQUEST);
        }

        if (billing.plan === targetPlan) {
            throw new HttpException('Target plan must be different from current plan', HttpStatus.BAD_REQUEST);
        }

        const planOrder = [BillingPlanEnum.FREE, BillingPlanEnum.STARTER, BillingPlanEnum.GROWTH, BillingPlanEnum.ENTERPRISE];

        const currentIndex = planOrder.indexOf(billing.plan as BillingPlanEnum);
        const targetIndex = planOrder.indexOf(targetPlan);

        if (currentIndex === -1 || targetIndex === -1) {
            throw new HttpException('Unsupported billing plan for downgrade', HttpStatus.BAD_REQUEST);
        }

        if (targetIndex >= currentIndex) {
            throw new HttpException('Target plan must be lower than current plan for downgrade', HttpStatus.BAD_REQUEST);
        }

        if (billing.pendingDowngradePlan) {
            throw new HttpException('There is already a pending downgrade scheduled for this subscription', HttpStatus.BAD_REQUEST);
        }

        await this.validateDowngradeUsageOrThrow(targetPlan);

        const previousPlan = billing.plan;
        const userId = this.tenantContext.getUserId();

        const schedule = await this.stripeService.scheduleSubscriptionDowngrade({
            stripeSubscriptionId: billing.stripeSubscriptionId,
            targetPlan
        });

        await this.prisma.billing.update({
            where: { id: billing.id },
            data: {
                pendingDowngradePlan: targetPlan,
                downgradeScheduledAt: schedule.effectiveDate ?? null
            }
        });

        this.txEventEmitter.emitAfterCommit(
            BillingEvents.SUBSCRIPTION_DOWNGRADE_SCHEDULED,
            new SubscriptionDowngradeScheduledEvent(
                billing.id,
                billing.tenantId,
                previousPlan,
                targetPlan,
                schedule.effectiveDate ? this.dateService.toISO(schedule.effectiveDate) : this.dateService.nowISO(),
                userId ?? undefined
            )
        );

        this.logger.log(`Subscription downgrade scheduled from ${previousPlan} to ${targetPlan}`, {
            tenantId: billing.tenantId,
            previousPlan,
            targetPlan,
            effectiveDate: schedule.effectiveDate
        });

        return await this.getCurrentSubscription();
    }

    async cancelPendingDowngrade(): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to cancel downgrade for this tenant', HttpStatus.BAD_REQUEST);
        }

        if (!billing.pendingDowngradePlan) {
            throw new HttpException('No pending downgrade to cancel for this subscription', HttpStatus.BAD_REQUEST);
        }

        await this.stripeService.cancelPendingSubscriptionDowngrade(billing.stripeSubscriptionId);

        const previousPendingPlan = billing.pendingDowngradePlan;
        const previousScheduledAt = billing.downgradeScheduledAt;

        await this.prisma.billing.update({
            where: { id: billing.id },
            data: {
                pendingDowngradePlan: null,
                downgradeScheduledAt: null
            }
        });

        this.logger.log(`Pending subscription downgrade to plan ${previousPendingPlan} scheduled at ${previousScheduledAt} was cancelled`, {
            tenantId: billing.tenantId
        });

        return await this.getCurrentSubscription();
    }

    async handleStripeWebhook(rawBody: Buffer | string, signature: string): Promise<void> {
        let event: Stripe.Event;
        try {
            event = this.stripeService.constructWebhookEvent(rawBody, signature);
        } catch (err) {
            this.logger.error('Failed to construct Stripe webhook event', err instanceof Error ? err.stack : String(err));
            const counter = this.metricsService.createCounter('billing_subscription_events_total');
            counter.add(1, { event: 'unknown', result: 'error' });
            throw err;
        }

        const eventId = event.id;
        const consumerName = 'stripe-webhook';

        this.logger.log(`Received Stripe webhook event ${event.type} (id=${eventId})`);

        if (eventId) {
            const isDuplicate = await this.idempotencyService.isDuplicate(`${consumerName}:${eventId}`);
            if (isDuplicate) {
                this.logger.warn(`Stripe webhook event already processed - eventId: ${eventId}, type: ${event.type}, consumerName: ${consumerName}`);
                const counter = this.metricsService.createCounter('billing_subscription_events_total');
                counter.add(1, { event: event.type, result: 'duplicate' });
                return;
            }
        }

        let result: 'ok' | 'error' = 'ok';

        try {
            switch (event.type) {
                case 'checkout.session.completed': {
                    await this.handleCheckoutSessionCompleted(event);
                    break;
                }
                case 'invoice.payment_succeeded':
                case 'invoice.paid': {
                    await this.handleInvoicePaymentSucceeded(event);
                    break;
                }
                case 'invoice_payment.paid': {
                    await this.handleInvoicePaymentSucceeded(event);
                    break;
                }
                case 'invoice.payment_failed': {
                    await this.handleInvoicePaymentFailed(event);
                    break;
                }
                case 'customer.subscription.deleted': {
                    await this.handleCustomerSubscriptionDeleted(event);
                    break;
                }
                default:
                    this.logger.debug(`Ignoring unsupported Stripe event type: ${event.type}`);
            }
        } catch (err) {
            result = 'error';
            this.logger.error(
                `Error handling Stripe webhook event ${event.type} (id=${eventId ?? 'unknown'})`,
                err instanceof Error ? err.stack : String(err)
            );
            throw err;
        } finally {
            const counter = this.metricsService.createCounter('billing_subscription_events_total');
            counter.add(1, { event: event.type, result });

            if (eventId && result === 'ok') {
                await this.idempotencyService.markProcessed(`${consumerName}:${eventId}`);
            }
        }
    }

    private async handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = session.metadata || {};
        const tenantId = metadata.tenantId as string | undefined;
        const planId = metadata.planId as BillingPlanEnum | undefined;
        const userId = metadata.userId as string | undefined;

        if (!tenantId || !planId) {
            this.logger.warn('Stripe checkout.session.completed missing tenantId or planId metadata');
            return;
        }

        let billing = await this.prisma.billing.findUnique({
            where: { tenantId }
        });

        if (!billing) {
            billing = await this.prisma.billing.create({
                data: {
                    tenantId,
                    plan: BillingPlanEnum.FREE,
                    status: SubscriptionStatusEnum.NONE
                }
            });
        }

        const previousPlan = billing.plan;
        const previousStatus = billing.status;
        const previousStripeSubscriptionId = billing.stripeSubscriptionId;

        const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;

        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

        const updateData: Prisma.BillingUpdateInput = {
            stripeCustomerId: customerId ?? null,
            stripeTransactionId: paymentIntentId ?? billing.stripeTransactionId
        };

        if (planId === BillingPlanEnum.FREE) {
            updateData.plan = BillingPlanEnum.FREE;
            updateData.status = SubscriptionStatusEnum.NONE;
            updateData.stripeSubscriptionId = null;
            this.logger.log(`Processed checkout.session.completed for tenant ${tenantId}: plan=Free, status=None, customer=${session.customer}`);
        } else {
            updateData.plan = planId;
            updateData.status = SubscriptionStatusEnum.ACTIVE;
            const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
            updateData.stripeSubscriptionId = subscriptionId ?? null;
            this.logger.log(
                `Processed checkout.session.completed for tenant ${tenantId}: plan=${planId}, status=Active, customer=${customerId}, subscription=${subscriptionId}`
            );
        }

        await this.prisma.billing.update({
            where: { id: billing.id },
            data: updateData
        });

        if (planId !== BillingPlanEnum.FREE) {
            await this.endTenantTrialIfActive(tenantId);
        }

        const isNewPaidSubscription =
            planId !== BillingPlanEnum.FREE &&
            updateData.status === SubscriptionStatusEnum.ACTIVE &&
            (previousStatus !== SubscriptionStatusEnum.ACTIVE || !previousStripeSubscriptionId);

        if (isNewPaidSubscription) {
            this.txEventEmitter.emitAfterCommit(
                BillingEvents.SUBSCRIPTION_CREATED,
                new SubscriptionCreatedEvent(
                    billing.id,
                    tenantId,
                    planId,
                    SubscriptionStatusEnum.ACTIVE,
                    typeof updateData.stripeSubscriptionId === 'string' ? updateData.stripeSubscriptionId : undefined,
                    typeof updateData.stripeCustomerId === 'string' ? updateData.stripeCustomerId : undefined,
                    undefined,
                    undefined,
                    event.id,
                    userId ?? undefined
                )
            );
        }

        this.txEventEmitter.emitAfterCommit(
            BillingEvents.SUBSCRIPTION_CHANGED,
            new SubscriptionChangedEvent(
                billing.id,
                tenantId,
                planId,
                typeof updateData.status === 'string' ? updateData.status : billing.status,
                typeof updateData.stripeSubscriptionId === 'string' ? updateData.stripeSubscriptionId : undefined,
                typeof updateData.stripeCustomerId === 'string' ? updateData.stripeCustomerId : undefined,
                undefined,
                undefined,
                event.id
            )
        );

        this.logger.log(`Subscription updated via Stripe checkout`, {
            tenantId,
            previousPlan,
            previousStatus,
            newPlan: planId,
            newStatus: updateData.status,
            stripeEventId: event.id
        });
    }

    private async handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
        const invoice = event.data.object as Stripe.Invoice;
        const { invoiceId, paymentIntentId, subscriptionId } = this.extractInvoiceIds(invoice);

        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

        if (!subscriptionId && !customerId) {
            this.logger.warn(`invoice.payment_failed missing subscription/customer reference: eventId=${event.id}, invoiceId=${invoiceId}`);
            return;
        }

        const billing = await this.findBillingBySubscriptionOrCustomer(subscriptionId, customerId);

        if (!billing) {
            this.logger.warn(
                `invoice.payment_failed: no Billing found for subscriptionId=${subscriptionId ?? 'unknown'}, customerId=${customerId ?? 'unknown'}, eventId=${event.id}, invoiceId=${invoiceId}`
            );
            return;
        }

        const nextAttempt = invoice.next_payment_attempt ? this.dateService.fromUnix(invoice.next_payment_attempt).toDate() : null;

        await this.markTenantPaymentAsPastDue(billing, event, invoiceId, {
            paymentIntentId,
            nextAttempt
        });

        this.logger.warn(
            `Processed invoice.payment_failed from Stripe: eventId=${event.id}, invoiceId=${invoiceId}, subscriptionId=${subscriptionId ?? 'unknown'}, customerId=${customerId ?? 'unknown'}, paymentIntentId=${paymentIntentId ?? 'unknown'}`
        );
    }

    private async findBillingBySubscriptionOrCustomer(subscriptionId: string | undefined, customerId: string | undefined): Promise<Billing | null> {
        if (subscriptionId) {
            const billing = await this.prisma.billing.findFirst({
                where: { stripeSubscriptionId: subscriptionId }
            });
            if (billing) {
                return billing;
            }
        }

        if (customerId) {
            return this.prisma.billing.findFirst({
                where: { stripeCustomerId: customerId }
            });
        }

        return null;
    }

    private async markTenantPaymentAsPastDue(
        billing: Billing,
        event: Stripe.Event,
        invoiceId: string,
        context: { paymentIntentId?: string; nextAttempt: Date | null }
    ): Promise<void> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: billing.tenantId }
            });

            if (!tenant) {
                this.logger.warn(
                    `invoice.payment_failed: no Tenant found for tenantId=${billing.tenantId}, eventId=${event.id}, invoiceId=${invoiceId}`
                );
                return;
            }

            if (tenant.paymentStatus === PaymentStatusEnum.PAST_DUE) {
                return;
            }

            const previousStatus = tenant.paymentStatus;
            const changedAt = new Date();

            this.logger.warn(
                `Set tenant ${tenant.id} paymentStatus=PAST_DUE due to invoice.payment_failed (next_attempt=${context.nextAttempt ? this.dateService.toISO(context.nextAttempt) : 'none'})`
            );

            await this.prisma.tenant.update({
                where: { id: tenant.id },
                data: {
                    paymentStatus: PaymentStatusEnum.PAST_DUE,
                    paymentStatusChangedAt: changedAt
                }
            });

            this.txEventEmitter.emitAfterCommit(
                BillingEvents.TENANT_PAYMENT_STATUS_CHANGED,
                new TenantPaymentStatusChangedEvent(
                    tenant.id,
                    tenant.id,
                    previousStatus,
                    PaymentStatusEnum.PAST_DUE,
                    this.dateService.toISO(changedAt),
                    undefined,
                    undefined,
                    billing.stripeCustomerId ?? undefined,
                    billing.stripeSubscriptionId ?? undefined,
                    invoiceId,
                    context.paymentIntentId ?? undefined,
                    context.nextAttempt ? this.dateService.toISO(context.nextAttempt) : null
                )
            );
        } catch (err) {
            this.logger.error(
                `Failed to update tenant paymentStatus for invoice.payment_failed: tenantId=${billing.tenantId}, eventId=${event.id}, invoiceId=${invoiceId}`,
                err instanceof Error ? err.stack : String(err)
            );
        }
    }

    private async endTenantTrialIfActive(tenantId: string): Promise<void> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId }
            });

            if (!tenant?.trialEndsAt) {
                return;
            }

            const now = new Date();

            if (tenant.trialEndsAt > now) {
                await this.prisma.tenant.update({
                    where: { id: tenantId },
                    data: { trialEndsAt: now }
                });

                this.logger.log(`Ended trial early for tenant ${tenantId} at ${this.dateService.toISO(now)} due to paid subscription checkout`);
            }
        } catch (err) {
            this.logger.error(`Failed to end trial early for tenant ${tenantId}`, err instanceof Error ? err.stack : String(err));
        }
    }

    private async handleCustomerSubscriptionDeleted(event: Stripe.Event): Promise<void> {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;

        const billing = await this.prisma.billing.findFirst({
            where: { stripeSubscriptionId: subscriptionId }
        });

        if (!billing) {
            this.logger.warn(`customer.subscription.deleted: no Billing found for subscriptionId=${subscriptionId}, eventId=${event.id}`);
            return;
        }

        const previousPlan = billing.plan;
        const previousStatus = billing.status;

        const effectiveDate = subscription.ended_at ? this.dateService.fromUnix(subscription.ended_at).toDate() : new Date();

        await this.prisma.billing.update({
            where: { id: billing.id },
            data: {
                status: SubscriptionStatusEnum.CANCELED,
                cancellationEffectiveAt: billing.cancellationEffectiveAt ?? effectiveDate,
                stripeSubscriptionId: null
            }
        });

        this.logger.log(
            `Processed customer.subscription.deleted from Stripe: eventId=${event.id}, subscriptionId=${subscriptionId}, tenantId=${billing.tenantId}`
        );

        this.logger.log(`Stripe subscription ${subscriptionId} expired/cancelled`, {
            tenantId: billing.tenantId,
            previousPlan,
            previousStatus,
            newStatus: SubscriptionStatusEnum.CANCELED,
            cancellationEffectiveAt: billing.cancellationEffectiveAt ?? effectiveDate
        });
    }
}
