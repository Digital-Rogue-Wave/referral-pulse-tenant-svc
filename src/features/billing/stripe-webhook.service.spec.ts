import { HttpStatus } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';
import type Stripe from 'stripe';

import { DatabaseService } from '@app/database/database.service';
import { BillingPlanEnum, PaymentStatusEnum, SubscriptionStatusEnum } from '@common/enums/billing.enum';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';

import { StripeService } from './stripe.service';
import { StripeWebhookService } from './stripe-webhook.service';

const CREATED = 1_760_000_000;
const BILLING = {
    id: 'bil_1',
    tenantId: 'ten_1',
    plan: BillingPlanEnum.GROWTH,
    status: SubscriptionStatusEnum.ACTIVE,
    stripeSubscriptionId: 'sub_123',
    stripeCustomerId: 'cus_1',
    pendingDowngradePlan: null,
    cancellationRequestedAt: null,
    cancellationEffectiveAt: null,
    lastStripeEventAt: null
};

const stripeEvent = (type: string, object: object, created = CREATED): Stripe.Event =>
    ({ id: `evt_${type}`, type, created, data: { object } }) as unknown as Stripe.Event;

describe('StripeWebhookService', () => {
    let prisma: MockProxy<DatabaseService>;
    let stripe: MockProxy<StripeService>;
    let events: MockProxy<TransactionEventEmitterService>;
    let tx: {
        billing: { findFirst: jest.Mock; upsert: jest.Mock; updateMany: jest.Mock };
        tenant: { findUnique: jest.Mock; updateMany: jest.Mock };
        stripeEvent: { update: jest.Mock };
        $queryRaw: jest.Mock;
    };
    let service: StripeWebhookService;

    const deliver = async (event: Stripe.Event): Promise<void> => {
        stripe.constructWebhookEvent.mockReturnValue(event);
        await service.handle('{}', 'sig');
    };
    const emitted = (): string[] => events.emitAfterCommit.mock.calls.map(([name]) => name);

    beforeEach(() => {
        tx = {
            billing: {
                findFirst: jest.fn().mockResolvedValue(BILLING),
                upsert: jest.fn().mockResolvedValue(BILLING),
                updateMany: jest.fn().mockResolvedValue({ count: 1 })
            },
            tenant: {
                findUnique: jest.fn().mockResolvedValue({ paymentStatus: PaymentStatusEnum.ACTIVE }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 })
            },
            stripeEvent: { update: jest.fn() },
            $queryRaw: jest.fn().mockResolvedValue([{ status: 'received' }])
        };
        prisma = mock<DatabaseService>();
        Object.assign(prisma, {
            stripeEvent: { createMany: jest.fn(), update: jest.fn() },
            $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) => fn(tx))
        });
        stripe = mock<StripeService>();
        events = mock<TransactionEventEmitterService>();
        const metrics = mock<MetricsService>();
        metrics.createCounter.mockReturnValue({ add: jest.fn() } as never);
        service = new StripeWebhookService(prisma, stripe, events, metrics, mock<AppLoggerService>());
    });

    describe('delivery guarantees', () => {
        it('records every event and marks it processed in the same transaction as its effect', async () => {
            await deliver(stripeEvent('customer.subscription.deleted', { id: 'sub_123', ended_at: CREATED }));

            expect(prisma.stripeEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
            expect(tx.stripeEvent.update).toHaveBeenCalledWith({
                where: { id: 'evt_customer.subscription.deleted' },
                data: expect.objectContaining({ status: 'processed' })
            });
        });

        it('acknowledges a redelivered event without applying it again', async () => {
            tx.$queryRaw.mockResolvedValue([{ status: 'processed' }]);

            await deliver(stripeEvent('customer.subscription.deleted', { id: 'sub_123' }));

            expect(tx.billing.updateMany).not.toHaveBeenCalled();
            expect(events.emitAfterCommit).not.toHaveBeenCalled();
        });

        it('ignores an event older than the state already applied (compare-and-set on last_stripe_event_at)', async () => {
            tx.billing.updateMany.mockResolvedValue({ count: 0 });

            await deliver(stripeEvent('invoice.payment_failed', { id: 'in_1', subscription: 'sub_123', customer: 'cus_1' }));

            expect(tx.billing.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'bil_1', OR: [{ lastStripeEventAt: null }, { lastStripeEventAt: { lte: new Date(CREATED * 1000) } }] }
                })
            );
            expect(tx.tenant.updateMany).not.toHaveBeenCalled();
            expect(tx.stripeEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ignored' }) }));
        });

        it('records a failure and rethrows it, so Stripe redelivers the event', async () => {
            tx.billing.findFirst.mockRejectedValue(new Error('db down'));

            await expect(deliver(stripeEvent('customer.subscription.deleted', { id: 'sub_123' }))).rejects.toThrow('db down');
            expect(prisma.stripeEvent.update).toHaveBeenCalledWith({
                where: { id: 'evt_customer.subscription.deleted' },
                data: expect.objectContaining({ status: 'failed', lastError: 'db down' })
            });
        });

        it('rejects a bad signature with 400, which Stripe does not retry', async () => {
            stripe.constructWebhookEvent.mockImplementation(() => {
                throw new Error('No signatures found');
            });

            const error = await service.handle('{}', 'bad').catch((e: BaseException) => e);

            expect((error as BaseException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
            expect(prisma.stripeEvent.createMany).not.toHaveBeenCalled();
        });
    });

    describe('subscription lifecycle', () => {
        it('drops a deleted subscription to a cancelled Free plan and publishes subscription.cancelled', async () => {
            await deliver(stripeEvent('customer.subscription.deleted', { id: 'sub_123', ended_at: CREATED }));

            expect(tx.billing.updateMany.mock.calls[0]![0].data).toMatchObject({
                plan: BillingPlanEnum.FREE,
                status: SubscriptionStatusEnum.CANCELED,
                stripeSubscriptionId: null
            });
            expect(emitted()).toEqual(['subscription.cancelled']);
        });

        it('mirrors a subscription update from Stripe: status, plan and a scheduled cancellation', async () => {
            stripe.resolvePlanFromSubscription.mockReturnValue(BillingPlanEnum.STARTER);

            await deliver(
                stripeEvent('customer.subscription.updated', {
                    id: 'sub_123',
                    customer: 'cus_1',
                    status: 'past_due',
                    cancel_at_period_end: true,
                    items: { data: [{ current_period_start: CREATED, current_period_end: CREATED + 86_400 }] }
                })
            );

            expect(tx.billing.updateMany.mock.calls[0]![0].data).toMatchObject({
                status: SubscriptionStatusEnum.PAST_DUE,
                plan: BillingPlanEnum.STARTER,
                cancellationEffectiveAt: new Date((CREATED + 86_400) * 1000)
            });
            expect(tx.tenant.updateMany).toHaveBeenCalledWith({
                where: { id: 'ten_1', paymentStatus: PaymentStatusEnum.ACTIVE },
                data: expect.objectContaining({ paymentStatus: PaymentStatusEnum.PAST_DUE })
            });
            expect(emitted()).toEqual(['tenant.payment-status-changed', 'subscription.changed']);
        });

        it('activates a paid plan on checkout, ends the trial and announces the new subscription', async () => {
            tx.billing.upsert.mockResolvedValue({
                ...BILLING,
                plan: BillingPlanEnum.FREE,
                status: SubscriptionStatusEnum.NONE,
                stripeSubscriptionId: null
            });

            await deliver(
                stripeEvent('checkout.session.completed', {
                    id: 'cs_1',
                    customer: 'cus_1',
                    subscription: 'sub_new',
                    payment_intent: null,
                    metadata: { tenantId: 'ten_1', planId: BillingPlanEnum.GROWTH, userId: 'u1' }
                })
            );

            expect(tx.billing.updateMany.mock.calls[0]![0].data).toMatchObject({
                plan: BillingPlanEnum.GROWTH,
                status: SubscriptionStatusEnum.ACTIVE,
                stripeSubscriptionId: 'sub_new',
                stripeCustomerId: 'cus_1'
            });
            expect(tx.tenant.updateMany).toHaveBeenCalledWith({
                where: { id: 'ten_1', trialEndsAt: { gt: expect.any(Date) } },
                data: { trialEndsAt: expect.any(Date) }
            });
            expect(emitted()).toEqual(['subscription.created', 'subscription.changed']);
        });

        it('ignores a subscription it cannot link yet (checkout.session.completed links it)', async () => {
            tx.billing.findFirst.mockResolvedValue(null);

            await deliver(stripeEvent('customer.subscription.created', { id: 'sub_new', customer: 'cus_new', status: 'active' }));

            expect(tx.billing.updateMany).not.toHaveBeenCalled();
        });
    });

    describe('payments', () => {
        it('restores a past-due tenant when the invoice is paid, and applies a plan changed in Stripe', async () => {
            tx.tenant.findUnique.mockResolvedValue({ paymentStatus: PaymentStatusEnum.RESTRICTED });
            stripe.getSubscription.mockResolvedValue({} as Stripe.Subscription);
            stripe.resolvePlanFromSubscription.mockReturnValue(BillingPlanEnum.ENTERPRISE);

            await deliver(stripeEvent('invoice.paid', { id: 'in_1', subscription: 'sub_123', payment_intent: 'pi_1' }));

            expect(tx.billing.updateMany.mock.calls[0]![0].data).toMatchObject({ plan: BillingPlanEnum.ENTERPRISE, stripeTransactionId: 'pi_1' });
            expect(tx.tenant.updateMany).toHaveBeenCalledWith({
                where: { id: 'ten_1', paymentStatus: PaymentStatusEnum.RESTRICTED },
                data: expect.objectContaining({ paymentStatus: PaymentStatusEnum.ACTIVE })
            });
        });

        it('never moves an already restricted tenant back to past_due on another failed payment', async () => {
            tx.tenant.findUnique.mockResolvedValue({ paymentStatus: PaymentStatusEnum.RESTRICTED });

            await deliver(stripeEvent('invoice.payment_failed', { id: 'in_2', subscription: 'sub_123', customer: 'cus_1' }));

            expect(tx.tenant.updateMany).not.toHaveBeenCalled();
        });

        it('asks the Owner to authenticate a payment when Stripe requires it (SCA)', async () => {
            await deliver(
                stripeEvent('invoice.payment_action_required', {
                    id: 'in_3',
                    subscription: 'sub_123',
                    hosted_invoice_url: 'https://invoice.stripe.com/i/x',
                    amount_due: 4900,
                    currency: 'eur'
                })
            );

            expect(events.emitAfterCommit).toHaveBeenCalledWith(
                'payment.action_required',
                expect.objectContaining({ hostedInvoiceUrl: 'https://invoice.stripe.com/i/x', amountDue: 4900 })
            );
        });

        it('publishes a dispute, found through the charge’s customer', async () => {
            stripe.getChargeCustomerId.mockResolvedValue('cus_1');

            await deliver(
                stripeEvent('charge.dispute.created', {
                    id: 'dp_1',
                    charge: 'ch_1',
                    amount: 4900,
                    currency: 'eur',
                    reason: 'fraudulent',
                    status: 'needs_response'
                })
            );

            expect(tx.billing.findFirst).toHaveBeenCalledWith({ where: { stripeCustomerId: 'cus_1' } });
            expect(events.emitAfterCommit).toHaveBeenCalledWith('payment.disputed', expect.objectContaining({ phase: 'opened', disputeId: 'dp_1' }));
        });

        it('publishes a refund', async () => {
            await deliver(stripeEvent('charge.refunded', { id: 'ch_1', customer: 'cus_1', amount_refunded: 4900, currency: 'eur', refunded: true }));

            expect(events.emitAfterCommit).toHaveBeenCalledWith(
                'payment.refunded',
                expect.objectContaining({ amountRefunded: 4900, fullyRefunded: true })
            );
        });
    });
});
