import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { RedisService } from '@common/redis/redis.service';

import { TrialLifecycleService } from './trial-lifecycle.service';

const NOW = new Date('2026-09-22T09:00:00Z');
const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

describe('TrialLifecycleService', () => {
    let prisma: {
        tenant: { findMany: jest.Mock; update: jest.Mock };
        plan: { findFirst: jest.Mock };
        billing: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
        $transaction: jest.Mock;
    };
    let redis: MockProxy<RedisService>;
    let events: MockProxy<TransactionEventEmitterService>;
    let service: TrialLifecycleService;

    const emitted = () => events.emitAfterCommit.mock.calls.map(([name]) => name);

    beforeEach(() => {
        prisma = {
            tenant: { findMany: jest.fn(), update: jest.fn() },
            plan: { findFirst: jest.fn().mockResolvedValue(null) },
            billing: {
                findUnique: jest.fn().mockResolvedValue({ id: 'b1', tenantId: 't1', plan: 'Growth', status: 'none', stripeCustomerId: 'cus_1' }),
                create: jest.fn(),
                update: jest.fn()
            },
            $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma))
        };
        redis = mock<RedisService>();
        redis.setNx.mockResolvedValue(true);
        const keys = mock<RedisKeyBuilder>();
        keys.buildDedupKey.mockImplementation((k: string) => k);
        events = mock<TransactionEventEmitterService>();
        service = new TrialLifecycleService(prisma as unknown as DatabaseService, mock<AppLoggerService>(), redis, keys, events);
    });

    it('reminds 3 days and 1 day before the trial ends, once each', async () => {
        prisma.tenant.findMany.mockResolvedValue([
            { id: 't3', trialEndsAt: inDays(2.5) },
            { id: 't1', trialEndsAt: inDays(0.5) },
            { id: 't7', trialEndsAt: inDays(6.5) },
            { id: 'tn', trialEndsAt: null }
        ]);

        await service.runDailyLifecycle(NOW);

        expect(emitted()).toEqual(['trial.reminder', 'trial.reminder']);
        redis.setNx.mockResolvedValue(false);
        events.emitAfterCommit.mockClear();
        await service.runDailyLifecycle(NOW);
        expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('drops an expired trial to the Free plan and announces the expiry in one transaction', async () => {
        prisma.tenant.findMany.mockResolvedValue([{ id: 't1', trialEndsAt: inDays(-1) }]);

        await service.runDailyLifecycle(NOW);

        expect(prisma.billing.update.mock.calls[0]![0].data).toMatchObject({ plan: 'Free', status: 'none', stripeSubscriptionId: null });
        expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { trialEndsAt: null } });
        expect(emitted()).toEqual(['subscription.changed', 'trial.expired']);
    });

    it('leaves a tenant alone when it already pays or is invoiced manually', async () => {
        prisma.tenant.findMany.mockResolvedValue([{ id: 't1', trialEndsAt: inDays(-1) }]);

        prisma.billing.findUnique.mockResolvedValue({ id: 'b1', tenantId: 't1', plan: 'Growth', status: 'past_due' });
        await service.runDailyLifecycle(NOW);
        prisma.plan.findFirst.mockResolvedValue({ id: 'manual' });
        await service.runDailyLifecycle(NOW);

        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('creates the billing record when missing, and ends the trial without re-announcing', async () => {
        prisma.tenant.findMany.mockResolvedValue([{ id: 't1', trialEndsAt: inDays(-1) }]);
        prisma.billing.findUnique.mockResolvedValue(null);
        prisma.billing.create.mockResolvedValue({ id: 'b1', tenantId: 't1', plan: 'Free', status: 'none' });
        redis.setNx.mockResolvedValue(false);

        await service.runDailyLifecycle(NOW);

        expect(prisma.billing.create).toHaveBeenCalled();
        expect(prisma.tenant.update).toHaveBeenCalled();
        expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });
});
