import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';

import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { PlanLimitService } from './plan-limit.service';
import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { IdempotencyService } from '@common/idempotency/idempotency.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { DateService } from '@common/helper/date.service';
import { TenantService } from '../tenant/tenant.service';
import { TenantStatsService } from '@app/features/tenant/aware/tenant-stats.service';
import { BillingPlanEnum, SubscriptionStatusEnum } from '@common/enums/billing.enum';
import { BillingEvents } from '@domains/billing';

/**
 * `customer.subscription.deleted` set `status = CANCELED` and nothing else — it
 * left `billing.plan` on the paid tier. Plan limits resolve from `billing.plan`
 * (PlanLimitService) and PaymentRequiredGuard only blocks on an explicit LOCKED
 * payment status, which cancellation never sets. A cancelled tenant therefore kept
 * full paid entitlements indefinitely, with no alert anywhere — a silent, ongoing
 * revenue leak. `BILLING_TASKS.md` marked this flow complete (3.6).
 */
describe('BillingService — Stripe subscription cancellation', () => {
    let service: BillingService;
    let prisma: MockProxy<DatabaseService>;
    let txEventEmitter: MockProxy<TransactionEventEmitterService>;

    const BILLING_ROW = {
        id: 'bil_1',
        tenantId: 'ten_1',
        plan: BillingPlanEnum.GROWTH,
        status: SubscriptionStatusEnum.ACTIVE,
        cancellationEffectiveAt: null
    };

    const deletedEvent = {
        id: 'evt_1',
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_123', ended_at: 1_760_000_000 } }
    };

    /** The handler is private; this exercises it directly rather than reconstructing a signed Stripe event. */
    const handleDeleted = (event: unknown): Promise<void> =>
        (service as unknown as { handleCustomerSubscriptionDeleted(e: unknown): Promise<void> }).handleCustomerSubscriptionDeleted(event);

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        (prisma as unknown as { billing: unknown }).billing = {
            findFirst: jest.fn().mockResolvedValue(BILLING_ROW),
            update: jest.fn().mockResolvedValue({ ...BILLING_ROW, plan: BillingPlanEnum.FREE })
        };
        txEventEmitter = mock<TransactionEventEmitterService>();

        const dateService = mock<DateService>();
        dateService.fromUnix.mockReturnValue({ toDate: () => new Date('2026-10-09T00:00:00.000Z') } as never);
        dateService.toISO.mockImplementation((d: Date) => d.toISOString());

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BillingService,
                { provide: DatabaseService, useValue: prisma },
                { provide: AppLoggerService, useValue: mock<AppLoggerService>() },
                { provide: TenantContextService, useValue: mock<TenantContextService>() },
                { provide: TransactionEventEmitterService, useValue: txEventEmitter },
                { provide: StripeService, useValue: mock<StripeService>() },
                { provide: IdempotencyService, useValue: mock<IdempotencyService>() },
                { provide: MetricsService, useValue: mock<MetricsService>() },
                { provide: TenantService, useValue: mock<TenantService>() },
                { provide: TenantStatsService, useValue: mock<TenantStatsService>() },
                { provide: PlanLimitService, useValue: mock<PlanLimitService>() },
                { provide: DateService, useValue: dateService }
            ]
        }).compile();

        service = module.get<BillingService>(BillingService);
    });

    it('resets the plan to Free, so entitlements actually drop', async () => {
        await handleDeleted(deletedEvent);

        const [{ data }] = (prisma.billing.update as jest.Mock).mock.calls[0];
        expect(data.plan).toBe(BillingPlanEnum.FREE);
    });

    it('still marks the subscription cancelled and clears the Stripe subscription id', async () => {
        await handleDeleted(deletedEvent);

        const [{ data }] = (prisma.billing.update as jest.Mock).mock.calls[0];
        expect(data.status).toBe(SubscriptionStatusEnum.CANCELED);
        expect(data.stripeSubscriptionId).toBeNull();
    });

    it('publishes subscription.cancelled so downstream services learn about it', async () => {
        await handleDeleted(deletedEvent);

        expect(txEventEmitter.emitAfterCommit).toHaveBeenCalledTimes(1);
        const [eventName, payload] = (txEventEmitter.emitAfterCommit as jest.Mock).mock.calls[0];

        expect(eventName).toBe(BillingEvents.SUBSCRIPTION_CANCELLED);
        expect(payload).toMatchObject({
            tenantId: 'ten_1',
            stripeSubscriptionId: 'sub_123',
            billingPlan: BillingPlanEnum.FREE
        });
    });

    it('does nothing when no billing row matches the subscription', async () => {
        (prisma.billing.findFirst as jest.Mock).mockResolvedValue(null);

        await handleDeleted(deletedEvent);

        expect(prisma.billing.update).not.toHaveBeenCalled();
        expect(txEventEmitter.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('preserves an already-recorded cancellation date rather than overwriting it', async () => {
        const scheduled = new Date('2026-09-30T00:00:00.000Z');
        (prisma.billing.findFirst as jest.Mock).mockResolvedValue({ ...BILLING_ROW, cancellationEffectiveAt: scheduled });

        await handleDeleted(deletedEvent);

        const [{ data }] = (prisma.billing.update as jest.Mock).mock.calls[0];
        expect(data.cancellationEffectiveAt).toBe(scheduled);
    });
});
