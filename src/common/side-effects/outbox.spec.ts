import { mock, MockProxy } from 'jest-mock-extended';
import type { Job } from 'bullmq';

import type { IOutboxJobData } from '@app/types';

import { KetoProvisioningService } from '@common/auth/authz/keto-provisioning.service';
import { BullJobsService } from '@common/bulljobs';
import { RoleEnum } from '@common/enums/role.enum';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DatabaseService } from '@app/database/database.service';
import { SideEffectService } from '@common/side-effects/side-effect.service';
import { KetoSyncListener } from '@common/events/listeners/keto-sync.listener';
import { UserRegisteredEvent, UserRemovedEvent, UserRoleChangedEvent } from '@domains/user';
import { TenantCreatedEvent, TenantDeletedEvent } from '@domains/tenant/events/tenant.events';

import { OutboxSweeperService } from './outbox-sweeper.service';
import { OutboxWorkerService } from './outbox-worker.service';

type OutboxRow = { id: string; status: string; effectType: string; payload: unknown; retryCount: number; maxRetries: number };

const job = (sideEffectId: string): Job<IOutboxJobData> =>
    ({
        data: { sideEffectId, effectType: 'keto', aggregateType: 'user', aggregateId: 'u1', eventType: 'keto.assign_role', tenantId: 't1' }
    }) as Job<IOutboxJobData>;

describe('Outbox worker', () => {
    let prisma: MockProxy<DatabaseService>;
    let keto: MockProxy<KetoProvisioningService>;
    let worker: OutboxWorkerService;
    let row: OutboxRow | null;
    let updateMany: jest.Mock;

    beforeEach(() => {
        prisma = mock<DatabaseService>();
        keto = mock<KetoProvisioningService>();
        row = {
            id: 'se-1',
            status: 'pending',
            effectType: 'keto',
            payload: { operation: 'assign_role', tenantId: 't1', userId: 'u1', role: RoleEnum.ADMIN },
            retryCount: 0,
            maxRetries: 10
        };
        updateMany = jest.fn(async () => ({ count: row?.status === 'pending' ? 1 : 0 }));
        (prisma as unknown as { sideEffectOutbox: unknown }).sideEffectOutbox = {
            updateMany,
            findUnique: jest.fn(async () => row),
            update: jest.fn(async ({ data }: { data: Partial<OutboxRow> }) => Object.assign(row!, data))
        };
        worker = Object.create(OutboxWorkerService.prototype) as OutboxWorkerService;
        Object.assign(worker, { prisma, ketoProvisioning: keto, logger: mock<AppLoggerService>() });
    });

    const process = (id = 'se-1') => (worker as unknown as { processJob: (j: Job<IOutboxJobData>) => Promise<unknown> }).processJob(job(id));

    it('claims a pending row atomically and mirrors the role into Keto', async () => {
        await process();

        expect(updateMany).toHaveBeenCalledWith({ where: { id: 'se-1', status: 'pending' }, data: { status: 'processing' } });
        expect(keto.assignRole).toHaveBeenCalledWith('t1', 'u1', RoleEnum.ADMIN);
        expect(row!.status).toBe('completed');
    });

    it('retries a job that arrived before its producer’s transaction committed, instead of reporting success', async () => {
        row = null;
        await expect(process()).rejects.toThrow(/not visible yet/);
    });

    it('does nothing when another run already claimed or completed the row', async () => {
        row!.status = 'completed';
        await expect(process()).resolves.toMatchObject({ success: true, data: { skipped: true } });
        expect(keto.assignRole).not.toHaveBeenCalled();
    });

    it('puts a failed Keto write back to pending for the next retry', async () => {
        keto.assignRole.mockRejectedValue(new Error('keto unavailable'));
        await expect(process()).rejects.toThrow('keto unavailable');
        expect(row).toMatchObject({ status: 'pending', retryCount: 1, lastError: 'keto unavailable' });
    });

    it.each([
        [{ operation: 'grant_tenant', tenantId: 't1' }, 'grantTenant', ['t1']],
        [{ operation: 'revoke_tenant', tenantId: 't1' }, 'revokeTenant', ['t1']],
        [{ operation: 'remove_member', tenantId: 't1', userId: 'u1' }, 'removeMember', ['t1', 'u1']]
    ] as const)('dispatches %o to %s', async (payload, method, args) => {
        row!.payload = payload;
        await process();
        expect(keto[method]).toHaveBeenCalledWith(...args);
    });
});

describe('Outbox sweeper', () => {
    it('releases rows held by a dead worker and re-enqueues rows whose enqueue was lost', async () => {
        const prisma = mock<DatabaseService>();
        const bullJobs = mock<BullJobsService>();
        const stale = [
            {
                id: 'se-9',
                tenantId: 't1',
                effectType: 'keto',
                aggregateType: 'tenant',
                aggregateId: 't1',
                eventType: 'keto.grant_tenant',
                maxRetries: 10,
                retryCount: 2
            }
        ];
        (prisma as unknown as { sideEffectOutbox: unknown }).sideEffectOutbox = {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue(stale)
        };
        const sweeper = Object.create(OutboxSweeperService.prototype) as OutboxSweeperService;
        Object.assign(sweeper, { prisma, bullJobs, logger: mock<AppLoggerService>() });

        const result = await (sweeper as unknown as { processJob: () => Promise<{ data: unknown }> }).processJob();

        expect((prisma.sideEffectOutbox.updateMany as jest.Mock).mock.calls[0][0]).toMatchObject({
            where: { status: 'processing' },
            data: { status: 'pending' }
        });
        expect(bullJobs.addJob).toHaveBeenCalledWith(
            'outbox-processor',
            'process-keto',
            expect.objectContaining({ sideEffectId: 'se-9' }),
            expect.objectContaining({ attempts: 8 })
        );
        expect(result.data).toEqual({ released: 1, reEnqueued: 1 });
    });
});

describe('KetoSyncListener', () => {
    let sideEffects: MockProxy<SideEffectService>;
    let listener: KetoSyncListener;

    beforeEach(() => {
        sideEffects = mock<SideEffectService>();
        listener = new KetoSyncListener(sideEffects, mock<AppLoggerService>());
    });

    it('queues the tenant grant matrix when a tenant is created and revokes it when deleted', async () => {
        await listener.onTenantCreated(new TenantCreatedEvent('t1', 't1', 'Acme', 'acme', 'kratos-1', new Date(), new Date()));
        await listener.onTenantDeleted(new TenantDeletedEvent('t1', 't1', 'Acme', 'acme'));
        expect(sideEffects.createKetoSideEffect).toHaveBeenCalledWith({ operation: 'grant_tenant', tenantId: 't1' });
        expect(sideEffects.createKetoSideEffect).toHaveBeenCalledWith({ operation: 'revoke_tenant', tenantId: 't1' });
    });

    it('queues the member’s role on registration and on every role change, and removal on removal', async () => {
        await listener.onUserRegistered(new UserRegisteredEvent('u1', 't1', RoleEnum.OWNER));
        await listener.onUserRoleChanged(new UserRoleChangedEvent('u1', 't1', RoleEnum.OWNER, RoleEnum.ADMIN));
        await listener.onUserRemoved(new UserRemovedEvent('u1', 't1', RoleEnum.ADMIN));
        expect(sideEffects.createKetoSideEffect.mock.calls.map(([payload]) => payload)).toEqual([
            { operation: 'assign_role', tenantId: 't1', userId: 'u1', role: RoleEnum.OWNER },
            { operation: 'assign_role', tenantId: 't1', userId: 'u1', role: RoleEnum.ADMIN },
            { operation: 'remove_member', tenantId: 't1', userId: 'u1' }
        ]);
    });

    it('does not throw into the event bus when the outbox write fails — the reconciler repairs it', async () => {
        sideEffects.createKetoSideEffect.mockRejectedValue(new Error('db down'));
        await expect(listener.onUserRegistered(new UserRegisteredEvent('u1', 't1', RoleEnum.VIEWER))).resolves.toBeUndefined();
    });
});
