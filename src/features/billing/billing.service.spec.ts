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

        it('carries every plan limit with its live use as usage counters (v5.2 API: GET /v1/billing/plan)', async () => {
            planLimits.entitlementsOf.mockResolvedValue({
                limits: { email_sends: 100, seats: 2, webhooks: null },
                usage: { email_sends: 45, seats: 2, events: 7 }
            } as never);

            const view = await service.getCurrentSubscription();

            expect(view.usage).toEqual([
                { metric: 'email_sends', currentUsage: 45, limit: 100, percentageUsed: 45 },
                // used but not limited by the plan
                { metric: 'events', currentUsage: 7, limit: null, percentageUsed: null },
                { metric: 'seats', currentUsage: 2, limit: 2, percentageUsed: 100 },
                // limited but not used yet
                { metric: 'webhooks', currentUsage: 0, limit: null, percentageUsed: null }
            ]);
        });
    });

    describe('checkout and payment methods', () => {
        it('starts a checkout with the tenant’s existing Stripe customer', async () => {
            prisma.billing.findUnique!.mockResolvedValue(billingRow({ plan: BillingPlanEnum.FREE, status: 'canceled', stripeSubscriptionId: null }));
            stripe.createSubscriptionCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/x' });

            await expect(service.subscriptionCheckout(BillingPlanEnum.STARTER)).resolves.toMatchObject({
                sessionId: 'cs_1',
                checkoutUrl: 'https://checkout.stripe.com/x'
            });
            expect(stripe.createSubscriptionCheckoutSession).toHaveBeenCalledWith(
                expect.objectContaining({ tenantId: 't1', customerId: 'cus_1', userId: 'u1' })
            );
        });

        it('refuses a second checkout while a subscription is live, so nobody pays twice (F2)', async () => {
            await expect(service.subscriptionCheckout(BillingPlanEnum.SCALE)).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
            expect(stripe.createSubscriptionCheckoutSession).not.toHaveBeenCalled();
        });

        it('refuses Free and Enterprise at checkout: Free needs none, Enterprise is sold by sales (F2, F6)', async () => {
            prisma.billing.findUnique!.mockResolvedValue(billingRow({ status: 'none', stripeSubscriptionId: null }));
            await expectHttp(service.subscriptionCheckout(BillingPlanEnum.FREE), HttpStatus.BAD_REQUEST);
            await expectHttp(service.subscriptionCheckout(BillingPlanEnum.ENTERPRISE), HttpStatus.BAD_REQUEST);
            expect(stripe.createSubscriptionCheckoutSession).not.toHaveBeenCalled();
        });

        it('refuses the portal without a Stripe customer', async () => {
            prisma.billing.findUnique!.mockResolvedValue(billingRow({ stripeCustomerId: null }));
            await expectHttp(service.createPortalSession(), HttpStatus.BAD_REQUEST);
        });

        it('pages invoices with Stripe cursors in both directions', async () => {
            stripe.listInvoicesForCustomer.mockResolvedValue({ hasMore: true, data: [{ id: 'in_3' }, { id: 'in_2' }] as never });

            await expect(service.listInvoices({ limit: 2 })).resolves.toMatchObject({ nextCursor: 'in_2', prevCursor: null, hasMore: true });
            await expect(service.listInvoices({ startingAfter: 'in_4' })).resolves.toMatchObject({ prevCursor: 'in_3' });
            await expect(service.listInvoices({ endingBefore: 'in_1' })).resolves.toMatchObject({ nextCursor: 'in_2', prevCursor: 'in_3' });

            prisma.billing.findUnique!.mockResolvedValue(billingRow({ stripeCustomerId: null }));
            await expect(service.listInvoices({})).resolves.toEqual({ data: [], hasMore: false, nextCursor: null, prevCursor: null });
        });
    });
});
