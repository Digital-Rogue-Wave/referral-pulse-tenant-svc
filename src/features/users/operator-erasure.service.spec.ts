import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { KratosService } from '@common/auth/kratos.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { hashEmail } from '@common/helper/hashing';

import { OperatorErasureService } from './operator-erasure.service';

const NOW = new Date('2026-09-22T10:00:00Z');
const HASH = hashEmail('ada@acme.io');
const member = (overrides: Record<string, unknown> = {}) => ({
    id: '01J0000000000000000000000A',
    tenantId: 't1',
    role: 'ADMIN',
    email: 'Ada@acme.io',
    kratosIdentityId: 'k-ada',
    deletedAt: null,
    ...overrides
});

describe('OperatorErasureService — identity step of a data-subject erasure', () => {
    let prisma: MockProxy<DatabaseService>;
    let kratos: MockProxy<KratosService>;
    let txEvents: MockProxy<TransactionEventEmitterService>;
    let tx: Record<string, Record<string, jest.Mock>>;
    let service: OperatorErasureService;

    beforeEach(() => {
        tx = {
            user: { update: jest.fn() },
            userRole: { deleteMany: jest.fn() },
            userNotificationPreference: { deleteMany: jest.fn() },
            invitation: { deleteMany: jest.fn() }
        };
        prisma = mock<DatabaseService>();
        Object.assign(prisma, {
            user: { findMany: jest.fn().mockResolvedValue([member()]) },
            tenant: { count: jest.fn().mockResolvedValue(0) },
            $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) => fn(tx))
        });
        kratos = mock<KratosService>();
        txEvents = mock<TransactionEventEmitterService>();
        service = new OperatorErasureService(prisma, kratos, txEvents, mock<AppLoggerService>());
    });

    it('anonymises the operator in place, deletes their identity and invitations, and returns a completed receipt', async () => {
        const receipt = await service.erase({ dsrId: 'dsr_1', subjectEmailHash: HASH }, NOW);

        expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { emailHash: HASH } }));
        expect(kratos.deleteIdentity).toHaveBeenCalledWith('k-ada');
        expect(tx.user!.update).toHaveBeenCalledWith({
            where: { id: member().id },
            data: expect.objectContaining({ name: null, status: 'disabled', kratosIdentityId: `erased:${member().id}` })
        });
        expect(tx.invitation!.deleteMany).toHaveBeenCalledWith({ where: { OR: [{ email: { equals: 'Ada@acme.io', mode: 'insensitive' } }] } });
        expect(receipt).toMatchObject({ dsrId: 'dsr_1', service: 'tenant-service', status: 'completed', erasedUserIds: [member().id] });
        expect(receipt.retained.length).toBeGreaterThan(0);
    });

    it('revokes an active membership and announces the erasure', async () => {
        await service.erase({ dsrId: 'dsr_1', subjectEmailHash: HASH }, NOW);

        expect(txEvents.emitAfterCommit.mock.calls.map(([name]) => name)).toEqual(['user.removed', 'user.anonymised']);
        expect(txEvents.emitAfterCommit.mock.calls[1]![1]).toMatchObject({ aggregateId: member().id, dsrId: 'dsr_1' });
    });

    it('does not revoke again a member who was already removed', async () => {
        (prisma.user.findMany as jest.Mock).mockResolvedValue([member({ deletedAt: new Date('2026-01-01') })]);

        await service.erase({ dsrId: 'dsr_1', subjectEmailHash: HASH }, NOW);

        expect(txEvents.emitAfterCommit.mock.calls.map(([name]) => name)).toEqual(['user.anonymised']);
    });

    it('is idempotent: an erased record is reported again but not processed', async () => {
        (prisma.user.findMany as jest.Mock).mockResolvedValue([member({ kratosIdentityId: `erased:${member().id}` })]);

        const receipt = await service.erase({ dsrId: 'dsr_1', subjectEmailHash: HASH }, NOW);

        expect(receipt.status).toBe('completed');
        expect(kratos.deleteIdentity).not.toHaveBeenCalled();
        expect(tx.user!.update).not.toHaveBeenCalled();
    });

    it('refuses to erase the Owner of an open tenant, which would leave it ownerless', async () => {
        (prisma.user.findMany as jest.Mock).mockResolvedValue([member({ role: 'OWNER' })]);
        (prisma.tenant.count as jest.Mock).mockResolvedValue(1);

        const receipt = await service.erase({ dsrId: 'dsr_1', subjectEmailHash: HASH }, NOW);

        expect(receipt).toMatchObject({ status: 'blocked', blockedReason: 'owner_of_active_tenant', erasedUserIds: [] });
        expect(kratos.deleteIdentity).not.toHaveBeenCalled();
    });

    it('reports not_found when tenant-service holds nothing about the subject', async () => {
        (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

        await expect(service.erase({ dsrId: 'dsr_1', subjectEmailHash: HASH }, NOW)).resolves.toMatchObject({ status: 'not_found' });
    });

    it('leaves the records untouched when the identity cannot be deleted, so the orchestrator retries', async () => {
        kratos.deleteIdentity.mockRejectedValue(new Error('kratos down'));

        await expect(service.erase({ dsrId: 'dsr_1', subjectEmailHash: HASH }, NOW)).rejects.toThrow('kratos down');
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
