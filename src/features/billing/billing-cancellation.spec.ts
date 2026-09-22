import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';

import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { PlanLimitService } from './plan-limit.service';
import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DateService } from '@common/helper/date.service';
import { TenantService } from '../tenant/tenant.service';
import { TenantStatsService } from '@app/features/tenant/aware/tenant-stats.service';
import { BillingPlanEnum, SubscriptionStatusEnum } from '@common/enums/billing.enum';

/**
 * Deleting a tenant must stop billing it. Stripe webhook cancellations are covered in
 * stripe-webhook.service.spec.ts.
 */
describe('BillingService.closeForDeletion — billing of a deleted tenant', () => {
    let service: BillingService;
    let prisma: MockProxy<DatabaseService>;
    let txEventEmitter: MockProxy<TransactionEventEmitterService>;
    let stripe: MockProxy<StripeService>;

    const BILLING_ROW = {
        id: 'bil_1',
        tenantId: 'ten_1',
        plan: BillingPlanEnum.GROWTH,
        status: SubscriptionStatusEnum.ACTIVE,
        stripeSubscriptionId: 'sub_123',
        cancellationRequestedAt: null,
        deletedAt: null
    };

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        Object.assign(prisma, {
            billing: { findUnique: jest.fn().mockResolvedValue(BILLING_ROW), update: jest.fn() },
            $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma))
        });
        txEventEmitter = mock<TransactionEventEmitterService>();
        stripe = mock<StripeService>();
        const dateService = mock<DateService>();
        dateService.toISO.mockImplementation((d: Date) => d.toISOString());

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                BillingService,
                { provide: DatabaseService, useValue: prisma },
                { provide: AppLoggerService, useValue: mock<AppLoggerService>() },
                { provide: TenantContextService, useValue: mock<TenantContextService>() },
                { provide: TransactionEventEmitterService, useValue: txEventEmitter },
                { provide: StripeService, useValue: stripe },
                { provide: TenantService, useValue: mock<TenantService>() },
                { provide: TenantStatsService, useValue: mock<TenantStatsService>() },
                { provide: PlanLimitService, useValue: mock<PlanLimitService>() },
                { provide: DateService, useValue: dateService }
            ]
        }).compile();

        service = module.get<BillingService>(BillingService);
    });

    it('ends the Stripe subscription now and drops the record to a cancelled Free plan', async () => {
        await service.closeForDeletion('ten_1');

        expect(stripe.cancelSubscriptionNow).toHaveBeenCalledWith('sub_123');
        const [{ data }] = (prisma.billing.update as jest.Mock).mock.calls[0];
        expect(data).toMatchObject({
            plan: BillingPlanEnum.FREE,
            status: SubscriptionStatusEnum.CANCELED,
            stripeSubscriptionId: null,
            cancellationReason: 'tenant_deleted'
        });
        expect(txEventEmitter.emitAfterCommit.mock.calls[0]![1]).toMatchObject({ reason: 'tenant_deleted', stripeSubscriptionId: 'sub_123' });
    });

    it('is a no-op the second time, so a retried saga does not fail', async () => {
        (prisma.billing.findUnique as jest.Mock).mockResolvedValue({ ...BILLING_ROW, deletedAt: new Date() });

        await service.closeForDeletion('ten_1');

        expect(stripe.cancelSubscriptionNow).not.toHaveBeenCalled();
        expect(prisma.billing.update).not.toHaveBeenCalled();
    });

    it('does not update the record when Stripe refuses the cancellation', async () => {
        stripe.cancelSubscriptionNow.mockRejectedValue(new Error('stripe down'));

        await expect(service.closeForDeletion('ten_1')).rejects.toThrow('stripe down');
        expect(prisma.billing.update).not.toHaveBeenCalled();
    });
});
