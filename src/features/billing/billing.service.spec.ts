import { HttpException, HttpStatus } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';
import moment from 'moment';

import { DatabaseService } from '@app/database/database.service';
import { BillingPlanEnum, PaymentStatusEnum, SubscriptionStatusEnum } from '@common/enums/billing.enum';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TenantStatsService } from '@app/features/tenant/aware/tenant-stats.service';
import { TenantService } from '@app/features/tenant/tenant.service';

import { BillingService } from './billing.service';
import { PlanLimitService } from './plan-limit.service';
import { StripeService } from './stripe.service';

const FUTURE = new Date(Date.now() + 10 * 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

const billingRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'bil_1',
    tenantId: 't1',
    plan: BillingPlanEnum.GROWTH,
    status: SubscriptionStatusEnum.ACTIVE,
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    stripeTransactionId: null,
    pendingDowngradePlan: null,
    downgradeScheduledAt: null,
    cancellationReason: null,
    cancellationRequestedAt: null,
    cancellationEffectiveAt: null,
    deletedAt: null,
    ...overrides
});

describe('BillingService — the tenant’s subscription', () => {
    let prisma: { billing: Record<string, jest.Mock>; tenantUsage: Record<string, jest.Mock>; $transaction: jest.Mock };
    let stripe: MockProxy<StripeService>;
    let tenants: MockProxy<TenantService>;
    let stats: MockProxy<TenantStatsService>;
    let planLimits: MockProxy<PlanLimitService>;
    let events: MockProxy<TransactionEventEmitterService>;
    let service: BillingService;

    const expectHttp = async (promise: Promise<unknown>, status: HttpStatus) => {
        const error = await promise.catch((e: HttpException) => e);
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(status);
    };

    beforeEach(() => {
        prisma = {
            billing: { findUnique: jest.fn().mockResolvedValue(billingRow()), create: jest.fn(), update: jest.fn() },
            tenantUsage: { findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma))
        };
        stripe = mock<StripeService>();
        stripe.getSubscription.mockResolvedValue({
            status: 'active',
            cancel_at_period_end: false,
            items: { data: [{ current_period_end: 1_900_000_000 }] }
        } as never);
        tenants = mock<TenantService>();
        tenants.findOneById.mockResolvedValue({ id: 't1', paymentStatus: 'past_due', trialEndsAt: null } as never);
        stats = mock<TenantStatsService>();
        stats.getStats.mockResolvedValue({ planUsagePercentage: 42 } as never);
        planLimits = mock<PlanLimitService>();
        events = mock<TransactionEventEmitterService>();
        const context = mock<TenantContextService>();
        context.getTenantId.mockReturnValue('t1');
        context.getUserId.mockReturnValue('u1');
        const dates = mock<DateService>();
        dates.nowMoment.mockImplementation(() => moment('2026-09-22'));
        dates.format.mockImplementation((m: moment.Moment | Date, f: string) => moment(m).format(f));
        dates.subtract.mockImplementation((m: moment.Moment | Date, n: number, unit: moment.unitOfTime.DurationConstructor) =>
            moment(m).subtract(n, unit)
        );
        dates.toISO.mockImplementation((d: Date) => d.toISOString());
        dates.nowISO.mockReturnValue('2026-09-22T00:00:00.000Z');
        dates.diff.mockReturnValue(3.2);
        service = new BillingService(
            prisma as unknown as DatabaseService,
            mock<AppLoggerService>(),
            context,
            events,
            stripe,
            tenants,
            stats,
            planLimits,
            dates
        );
    });

    describe('reading', () => {
        it('creates the Free billing record on first access', async () => {
            prisma.billing.findUnique!.mockResolvedValue(null);
            prisma.billing.create!.mockResolvedValue(billingRow({ plan: 'Free', status: 'none', stripeSubscriptionId: null }));

            const view = await service.getCurrentSubscription();

            expect(prisma.billing.create).toHaveBeenCalledWith({ data: { tenantId: 't1', plan: 'Free', status: 'none' } });
            expect(view.plan).toBe('Free');
        });

        it('reports the payment status even for a tenant that never had a trial, with Stripe’s period', async () => {
            const view = await service.getCurrentSubscription();

            expect(view).toMatchObject({
                paymentStatus: PaymentStatusEnum.PAST_DUE,
                trialActive: false,
                planUsagePercentage: 42,
                stripeSubscriptionStatus: 'active',
                stripeCancelAtPeriodEnd: false
            });
            expect(view.stripeCurrentPeriodEnd).toBe(new Date(1_900_000_000 * 1000).toISOString());
        });

        it('shows an active trial with its days remaining', async () => {
            tenants.findOneById.mockResolvedValue({ id: 't1', paymentStatus: 'active', trialEndsAt: FUTURE } as never);

            await expect(service.getCurrentSubscription()).resolves.toMatchObject({ trialActive: true, trialDaysRemaining: 4 });
        });

        it('still answers when Stripe or the stats are unavailable', async () => {
            stripe.getSubscription.mockRejectedValue(new Error('stripe down'));
            stats.getStats.mockRejectedValue(new Error('stats down'));

            await expect(service.getCurrentSubscription()).resolves.toMatchObject({ stripeSubscriptionStatus: null, planUsagePercentage: null });
        });

        it('summarises the last 7 days of usage per metric against the plan limits', async () => {
            planLimits.getPlanLimits.mockResolvedValue({ email_sends: 100 });
            prisma.tenantUsage.findMany!.mockResolvedValue([
                { metricName: 'email_sends', periodDate: '2026-09-21', currentUsage: 30 },
                { metricName: 'email_sends', periodDate: '2026-09-22', currentUsage: 40 },
                { metricName: 'webhooks', periodDate: '2026-09-22', currentUsage: 5 }
            ]);

            const summary = await service.getUsageSummary();

            expect(summary.metrics).toEqual([
                expect.objectContaining({
                    metric: 'email_sends',
                    currentUsage: 40,
                    limit: 100,
                    percentageUsed: 40,
                    history: [expect.anything(), expect.anything()]
                }),
                expect.objectContaining({ metric: 'webhooks', currentUsage: 5, limit: null, percentageUsed: null })
            ]);
        });
    });

    describe('checkout and payment methods', () => {
        it('starts a checkout with the tenant’s existing Stripe customer', async () => {
            stripe.createSubscriptionCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/x' });

            await expect(service.subscriptionCheckout(BillingPlanEnum.STARTER)).resolves.toMatchObject({
                sessionId: 'cs_1',
                checkoutUrl: 'https://checkout.stripe.com/x'
            });
            expect(stripe.createSubscriptionCheckoutSession).toHaveBeenCalledWith(
                expect.objectContaining({ tenantId: 't1', customerId: 'cus_1', userId: 'u1' })
            );
        });

        it('manages payment methods on the tenant’s customer and refuses without one', async () => {
            stripe.createSetupIntent.mockResolvedValue({ client_secret: 'seti_secret' } as never);
            await expect(service.createPaymentMethodSetupIntent()).resolves.toEqual({ clientSecret: 'seti_secret', customerId: 'cus_1' });

            await service.listPaymentMethods();
            await service.deletePaymentMethod('pm_1');
            await service.setDefaultPaymentMethod('pm_2');
            expect(stripe.detachPaymentMethodForCustomer).toHaveBeenCalledWith('cus_1', 'pm_1');
            expect(stripe.setDefaultPaymentMethodForCustomer).toHaveBeenCalledWith('cus_1', 'pm_2');

            prisma.billing.findUnique!.mockResolvedValue(billingRow({ stripeCustomerId: null }));
            await expectHttp(service.createPaymentMethodSetupIntent(), HttpStatus.BAD_REQUEST);
            await expectHttp(service.listPaymentMethods(), HttpStatus.BAD_REQUEST);
            await expectHttp(service.deletePaymentMethod('pm_1'), HttpStatus.BAD_REQUEST);
            await expectHttp(service.setDefaultPaymentMethod('pm_1'), HttpStatus.BAD_REQUEST);
            await expectHttp(service.createPortalSession(), HttpStatus.BAD_REQUEST);
        });

        it('fails loudly when Stripe returns a SetupIntent without a client secret', async () => {
            stripe.createSetupIntent.mockResolvedValue({ client_secret: null } as never);
            await expectHttp(service.createPaymentMethodSetupIntent(), HttpStatus.INTERNAL_SERVER_ERROR);
        });

        it('pages invoices with Stripe cursors in both directions', async () => {
            stripe.listInvoicesForCustomer.mockResolvedValue({ hasMore: true, data: [{ id: 'in_3' }, { id: 'in_2' }] as never });

            await expect(service.listInvoices({ limit: 2 })).resolves.toMatchObject({ nextCursor: 'in_2', prevCursor: null, hasMore: true });
            await expect(service.listInvoices({ startingAfter: 'in_4' })).resolves.toMatchObject({ prevCursor: 'in_3' });
            await expect(service.listInvoices({ endingBefore: 'in_1' })).resolves.toMatchObject({ nextCursor: 'in_2', prevCursor: 'in_3' });

            prisma.billing.findUnique!.mockResolvedValue(billingRow({ stripeCustomerId: null }));
            await expect(service.listInvoices({})).resolves.toEqual({ data: [], hasMore: false, nextCursor: null, prevCursor: null });
        });

        it('previews the upcoming invoice only for a subscribed tenant', async () => {
            await service.getUpcomingInvoice();
            expect(stripe.retrieveUpcomingInvoiceForCustomer).toHaveBeenCalledWith({ customerId: 'cus_1', subscriptionId: 'sub_1' });

            prisma.billing.findUnique!.mockResolvedValue(billingRow({ stripeSubscriptionId: null }));
            await expectHttp(service.getUpcomingInvoice(), HttpStatus.BAD_REQUEST);
        });
    });

    describe('changing the plan', () => {
        it('upgrades in Stripe first, then records the plan and announces it in one transaction', async () => {
            stripe.previewSubscriptionUpgrade.mockResolvedValue({ amountDueNow: 1500, currency: 'eur', nextInvoiceDate: FUTURE });
            await expect(service.previewSubscriptionUpgrade(BillingPlanEnum.ENTERPRISE)).resolves.toMatchObject({ amountDueNow: 1500 });

            await service.upgradeSubscription(BillingPlanEnum.ENTERPRISE);

            expect(stripe.upgradeSubscription).toHaveBeenCalledWith({ stripeSubscriptionId: 'sub_1', targetPlan: BillingPlanEnum.ENTERPRISE });
            expect(prisma.billing.update).toHaveBeenCalledWith({
                where: { id: 'bil_1' },
                data: { plan: BillingPlanEnum.ENTERPRISE, status: 'active' }
            });
            expect(events.emitAfterCommit).toHaveBeenCalledWith(
                'subscription.upgraded',
                expect.objectContaining({ billingPlan: BillingPlanEnum.ENTERPRISE })
            );
        });

        it('refuses plan changes without a subscription', async () => {
            prisma.billing.findUnique!.mockResolvedValue(billingRow({ stripeSubscriptionId: null }));
            await expectHttp(service.previewSubscriptionUpgrade(BillingPlanEnum.ENTERPRISE), HttpStatus.BAD_REQUEST);
            await expectHttp(service.upgradeSubscription(BillingPlanEnum.ENTERPRISE), HttpStatus.BAD_REQUEST);
            await expectHttp(service.downgradeSubscription(BillingPlanEnum.STARTER), HttpStatus.BAD_REQUEST);
            await expectHttp(service.cancelPendingDowngrade(), HttpStatus.BAD_REQUEST);
            await expectHttp(service.cancelSubscription({}), HttpStatus.BAD_REQUEST);
            await expectHttp(service.reactivateSubscription(), HttpStatus.BAD_REQUEST);
        });

        it('schedules a downgrade that fits the target plan', async () => {
            planLimits.limitsOfPlan.mockResolvedValue({ seats: 5 });
            planLimits.usageOf.mockResolvedValue(3);
            stripe.scheduleSubscriptionDowngrade.mockResolvedValue({ effectiveDate: FUTURE });

            await service.downgradeSubscription(BillingPlanEnum.STARTER);

            expect(prisma.billing.update).toHaveBeenCalledWith({
                where: { id: 'bil_1' },
                data: { pendingDowngradePlan: 'Starter', downgradeScheduledAt: FUTURE }
            });
            expect(events.emitAfterCommit).toHaveBeenCalledWith('subscription.downgrade-scheduled', expect.anything());
        });

        it('refuses a downgrade while usage exceeds the target plan, naming each metric', async () => {
            planLimits.limitsOfPlan.mockResolvedValue({ seats: 5, email_sends: 1000 });
            planLimits.usageOf.mockImplementation(async (_t, metric) => (metric === 'seats' ? 8 : 10));

            const error = await service.downgradeSubscription(BillingPlanEnum.STARTER).catch((e: BaseException) => e);

            expect((error as BaseException).getStatus()).toBe(HttpStatus.CONFLICT);
            expect((error as BaseException).message).toContain('seats 8/5');
            expect(stripe.scheduleSubscriptionDowngrade).not.toHaveBeenCalled();
        });

        it.each([
            ['the same plan', BillingPlanEnum.GROWTH, {}],
            ['a higher plan', BillingPlanEnum.ENTERPRISE, {}],
            ['a second pending downgrade', BillingPlanEnum.STARTER, { pendingDowngradePlan: 'Free' }],
            ['an unknown current plan', BillingPlanEnum.STARTER, { plan: 'Legacy' }]
        ])('refuses a downgrade to %s', async (_case, target, overrides) => {
            prisma.billing.findUnique!.mockResolvedValue(billingRow(overrides));
            await expectHttp(service.downgradeSubscription(target), HttpStatus.BAD_REQUEST);
        });

        it('cancels a pending downgrade in Stripe and clears it', async () => {
            prisma.billing.findUnique!.mockResolvedValue(billingRow({ pendingDowngradePlan: 'Starter' }));

            await service.cancelPendingDowngrade();

            expect(stripe.cancelPendingSubscriptionDowngrade).toHaveBeenCalledWith('sub_1');
            expect(prisma.billing.update).toHaveBeenCalledWith({
                where: { id: 'bil_1' },
                data: { pendingDowngradePlan: null, downgradeScheduledAt: null }
            });

            prisma.billing.findUnique!.mockResolvedValue(billingRow());
            await expectHttp(service.cancelPendingDowngrade(), HttpStatus.BAD_REQUEST);
        });
    });

    describe('cancelling', () => {
        it('schedules the cancellation at period end and announces it', async () => {
            stripe.scheduleSubscriptionCancellation.mockResolvedValue({ effectiveDate: FUTURE });

            await service.cancelSubscription({ reason: 'too expensive' });

            expect(prisma.billing.update).toHaveBeenCalledWith({
                where: { id: 'bil_1' },
                data: expect.objectContaining({ cancellationReason: 'too expensive', cancellationEffectiveAt: FUTURE })
            });
            expect(events.emitAfterCommit).toHaveBeenCalledWith('subscription.cancelled', expect.objectContaining({ reason: 'too expensive' }));
        });

        it('lets a past-due tenant cancel, but not an already cancelled one, nor twice', async () => {
            stripe.scheduleSubscriptionCancellation.mockResolvedValue({ effectiveDate: null });
            prisma.billing.findUnique!.mockResolvedValue(billingRow({ status: 'past_due' }));
            await expect(service.cancelSubscription({})).resolves.toBeDefined();

            prisma.billing.findUnique!.mockResolvedValue(billingRow({ status: 'canceled' }));
            await expectHttp(service.cancelSubscription({}), HttpStatus.BAD_REQUEST);

            prisma.billing.findUnique!.mockResolvedValue(billingRow({ cancellationRequestedAt: PAST, cancellationEffectiveAt: FUTURE }));
            await expectHttp(service.cancelSubscription({}), HttpStatus.BAD_REQUEST);
        });

        it('reactivates a pending cancellation, but not one already in effect', async () => {
            prisma.billing.findUnique!.mockResolvedValue(billingRow({ cancellationRequestedAt: PAST, cancellationEffectiveAt: FUTURE }));
            await service.reactivateSubscription();
            expect(stripe.reactivateSubscription).toHaveBeenCalledWith('sub_1');

            prisma.billing.findUnique!.mockResolvedValue(billingRow({ cancellationRequestedAt: PAST, cancellationEffectiveAt: PAST }));
            await expectHttp(service.reactivateSubscription(), HttpStatus.BAD_REQUEST);

            prisma.billing.findUnique!.mockResolvedValue(billingRow());
            await expectHttp(service.reactivateSubscription(), HttpStatus.BAD_REQUEST);
        });
    });
});
