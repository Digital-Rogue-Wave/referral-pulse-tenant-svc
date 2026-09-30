import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { DailyUsageCalculator } from './daily-usage-calculator.service';
import { PlanLimitService } from './plan-limit.service';
import { UsageCounterService } from './usage-counter.service';

const NOW = new Date('2026-09-22T02:00:00Z');

describe('DailyUsageCalculator', () => {
    let prisma: Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };
    let counters: MockProxy<UsageCounterService>;
    let planLimits: MockProxy<PlanLimitService>;
    let events: MockProxy<TransactionEventEmitterService>;
    let calculator: DailyUsageCalculator;

    beforeEach(() => {
        prisma = {
            tenantUsage: { upsert: jest.fn() },
            billingEvent: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
            $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma))
        } as never;
        counters = mock<UsageCounterService>();
        counters.current.mockResolvedValue({ email_sends: 85 });
        planLimits = mock<PlanLimitService>();
        planLimits.getPlanLimits.mockResolvedValue({ email_sends: 100 });
        planLimits.usageOf.mockResolvedValue(85);
        events = mock<TransactionEventEmitterService>();
        calculator = new DailyUsageCalculator(prisma as unknown as DatabaseService, mock<AppLoggerService>(), counters, planLimits, events);
    });

    it('records the day’s usage with its limit for the usage history', async () => {
        await calculator.snapshotTenant('t1', NOW);

        expect(prisma.tenantUsage!.upsert).toHaveBeenCalledWith({
            where: { tenantId_metricName_periodDate: { tenantId: 't1', metricName: 'email_sends', periodDate: '2026-09-22' } },
            create: expect.objectContaining({ currentUsage: 85, limitValue: 100 }),
            update: { currentUsage: 85, limitValue: 100 }
        });
    });

    it('announces the 80 % threshold once per metric and month', async () => {
        await calculator.snapshotTenant('t1', NOW);
        expect(events.emitAfterCommit).toHaveBeenCalledWith(
            'usage.threshold_crossed',
            expect.objectContaining({ threshold: 80, periodDate: '2026-09' })
        );

        events.emitAfterCommit.mockClear();
        prisma.billingEvent!.count!.mockResolvedValue(1);
        await calculator.snapshotTenant('t1', NOW);
        expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });
});
