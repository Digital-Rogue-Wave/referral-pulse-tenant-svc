import { mock, MockProxy } from 'jest-mock-extended';
import type { Job } from 'bullmq';

import { KetoProvisioningService } from '@common/auth/authz/keto-provisioning.service';
import { IdempotencyKeySweeperWorker } from '@common/http-contract/idempotency-key-sweeper.worker';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DomainMetrics } from '@common/monitoring/domain-metrics.service';
import { RedisService } from '@common/redis/redis.service';
import { DatabaseService } from '@app/database/database.service';
import { WorkerHealthServer } from '@app/health/worker-health.server';

import { DailyUsageCalculator } from './billing/daily-usage-calculator.service';
import { MonthlyUsageResetService } from './billing/monthly-usage-reset.service';
import { PaymentStatusEscalationService } from './billing/payment-status-escalation.service';
import { PlanStripeSyncService } from './billing/plan-stripe-sync.service';
import { BillingUsageProcessor } from './billing/processors/billing-usage.processor';
import { TrialLifecycleService } from './billing/trial-lifecycle.service';
import { TenantDeletionSweeperWorker } from './tenant-deletion/tenant-deletion-sweeper.worker';
import { TenantDeletionService } from './tenant-deletion/tenant-deletion.service';
import { TenantUnlockProcessor } from './tenant/processors/tenant-unlock.processor';
import { TenantService } from './tenant/tenant.service';
import { KetoReconcilerWorker } from './users/keto-reconciler.worker';

/** Builds a worker without its BullMQ plumbing and returns its `processJob`. */
function workerOf<W extends object>(type: abstract new (...args: never[]) => W, deps: Record<string, unknown>) {
    const worker = Object.create(type.prototype) as W;
    Object.assign(worker, { logger: mock<AppLoggerService>(), ...deps });
    return (name = 'run') =>
        (worker as unknown as { processJob: (job: Partial<Job>) => Promise<{ success: boolean; data?: unknown }> }).processJob({ name });
}

describe('Scheduled workers', () => {
    it('the deletion sweeper runs the saga for each due tenant and keeps going past a failure', async () => {
        const deletions = mock<TenantDeletionService>();
        deletions.findDue.mockResolvedValue(['t1', 't2', 't3']);
        deletions.execute.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('stripe down')).mockResolvedValueOnce(false);
        const metrics = mock<DomainMetrics>();

        await expect(workerOf(TenantDeletionSweeperWorker, { deletions, domainMetrics: metrics })()).resolves.toEqual({
            success: false,
            data: { deleted: 1, failed: ['t2'] }
        });
        expect(metrics.tenantDeletion).toHaveBeenCalledWith('deleted');
        expect(metrics.tenantDeletion).toHaveBeenCalledWith('failed');
    });

    it('the unlock sweeper unlocks expired timed locks', async () => {
        const tenantService = mock<TenantService>();
        tenantService.unlockExpired.mockResolvedValue(2);
        await expect(workerOf(TenantUnlockProcessor, { tenantService })()).resolves.toEqual({ success: true, data: { unlocked: 2 } });
    });

    it('the idempotency sweeper purges expired request keys', async () => {
        const deleteMany = jest.fn().mockResolvedValue({ count: 4 });
        await expect(workerOf(IdempotencyKeySweeperWorker, { prisma: { idempotencyKey: { deleteMany } } })()).resolves.toEqual({
            success: true,
            data: { purged: 4 }
        });
        expect(deleteMany.mock.calls[0]![0].where.expiresAt.lt).toBeInstanceOf(Date);
    });

    it('the Keto reconciler re-grants every tenant and member, and revokes recently deleted tenants', async () => {
        const keto = mock<KetoProvisioningService>();
        const findMany = jest
            .fn()
            .mockResolvedValueOnce([{ id: 't1' }])
            .mockResolvedValueOnce([{ id: 't-gone' }]);
        const users = jest.fn().mockResolvedValue([
            { id: 'u1', role: 'OWNER', deletedAt: null },
            { id: 'u2', role: 'VIEWER', deletedAt: new Date() }
        ]);

        await expect(
            workerOf(KetoReconcilerWorker, { prisma: { tenant: { findMany }, user: { findMany: users } }, ketoProvisioning: keto })()
        ).resolves.toEqual({
            success: true,
            data: { tenants: 1, revoked: 1 }
        });
        expect(keto.grantTenant).toHaveBeenCalledWith('t1');
        expect(keto.assignRole).toHaveBeenCalledWith('t1', 'u1', 'OWNER');
        expect(keto.removeMember).toHaveBeenCalledWith('t1', 'u2');
        expect(keto.revokeTenant).toHaveBeenCalledWith('t-gone');
    });

    it('the billing processor dispatches each scheduled billing job', async () => {
        const deps = {
            dailyUsageCalculator: mock<DailyUsageCalculator>(),
            monthlyUsageResetService: mock<MonthlyUsageResetService>(),
            paymentStatusEscalationService: mock<PaymentStatusEscalationService>(),
            trialLifecycleService: mock<TrialLifecycleService>(),
            planStripeSyncService: mock<PlanStripeSyncService>()
        };
        const run = workerOf(BillingUsageProcessor, deps);

        for (const name of ['monthly-usage-reset', 'daily-usage-snapshot', 'payment-status-escalation', 'trial-lifecycle', 'plan-stripe-sync']) {
            await run(name);
        }
        await expect(run('unknown')).resolves.toMatchObject({ success: false });

        expect(deps.monthlyUsageResetService.runMonthlyReset).toHaveBeenCalled();
        expect(deps.dailyUsageCalculator.runDailySnapshot).toHaveBeenCalled();
        expect(deps.paymentStatusEscalationService.runEscalation).toHaveBeenCalled();
        expect(deps.trialLifecycleService.runDailyLifecycle).toHaveBeenCalled();
        expect(deps.planStripeSyncService.syncFromStripe).toHaveBeenCalled();
    });
});

describe('WorkerHealthServer', () => {
    let redis: MockProxy<RedisService>;
    let server: WorkerHealthServer;
    let queryRaw: jest.Mock;

    beforeEach(() => {
        queryRaw = jest.fn().mockResolvedValue([{ ok: 1 }]);
        redis = mock<RedisService>();
        redis.ping.mockResolvedValue('PONG');
        server = new WorkerHealthServer({ $queryRaw: queryRaw } as unknown as DatabaseService, redis, mock<AppLoggerService>());
    });

    it('is live as long as the process answers, and ready when Postgres and Redis answer', async () => {
        await expect(server.respond('GET', '/health/live')).resolves.toEqual({ status: 200, body: { status: 'ok' } });
        await expect(server.respond('GET', '/health/ready')).resolves.toMatchObject({ status: 200 });

        redis.ping.mockRejectedValue(new Error('down'));
        await expect(server.respond('GET', '/health/ready')).resolves.toMatchObject({ status: 503, body: { info: { redis: { status: 'down' } } } });
    });

    it('serves nothing else', async () => {
        await expect(server.respond('GET', '/api/v1/tenants')).resolves.toMatchObject({ status: 404 });
        await expect(server.respond('POST', '/health/live')).resolves.toMatchObject({ status: 405 });
    });

    it('listens on the given port and closes on shutdown', async () => {
        await server.start(0);
        await expect(server.onApplicationShutdown()).resolves.toBeUndefined();
    });
});
