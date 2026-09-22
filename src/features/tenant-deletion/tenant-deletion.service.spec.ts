import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { KratosService } from '@common/auth/kratos.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantDeletedEvent } from '@domains/tenant/events/tenant.events';
import { BillingService } from '@app/features/billing/billing.service';

import { TenantDeletionService } from './tenant-deletion.service';

const NOW = new Date('2026-09-22T10:00:00Z');
const tenantRow = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    name: 'Acme',
    slug: 'acme',
    status: 'active',
    deletionDueAt: new Date('2026-09-22T09:00:00Z'),
    ...overrides
});

describe('TenantDeletionService — the deletion saga', () => {
    let prisma: MockProxy<DatabaseService>;
    let billing: MockProxy<BillingService>;
    let kratos: MockProxy<KratosService>;
    let txEvents: MockProxy<TransactionEventEmitterService>;
    let tx: Record<string, Record<string, jest.Mock>>;
    let order: string[];
    let service: TenantDeletionService;

    beforeEach(() => {
        order = [];
        const step = (name: string) => jest.fn().mockImplementation(() => (order.push(name), Promise.resolve({ count: 1 })));
        tx = {
            apiKey: { updateMany: step('keys revoked') },
            user: { update: step('member anonymised') },
            userRole: { deleteMany: step('roles cleared') },
            invitation: { deleteMany: step('invitations deleted') },
            userNotificationPreference: { deleteMany: step('preferences deleted') },
            tenantSetting: { deleteMany: step('settings deleted') },
            tenant: { update: step('tenant closed') }
        };
        prisma = mock<DatabaseService>();
        Object.assign(prisma, {
            tenant: { findUnique: jest.fn().mockResolvedValue(tenantRow()), findMany: jest.fn() },
            user: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 'U1', kratosIdentityId: 'k-1' },
                    { id: 'U2', kratosIdentityId: 'erased:U2' }
                ])
            },
            $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) => fn(tx))
        });
        billing = mock<BillingService>();
        billing.closeForDeletion.mockImplementation(() => (order.push('billing closed'), Promise.resolve()));
        kratos = mock<KratosService>();
        kratos.deleteIdentity.mockImplementation(() => (order.push('identity deleted'), Promise.resolve()));
        txEvents = mock<TransactionEventEmitterService>();
        service = new TenantDeletionService(prisma, billing, kratos, txEvents, mock<AppLoggerService>());
    });

    it('stops billing first, then deletes identities, then purges and closes the tenant in one transaction', async () => {
        await expect(service.execute('t1', NOW)).resolves.toBe(true);

        expect(order).toEqual([
            'billing closed',
            'identity deleted',
            'keys revoked',
            'member anonymised',
            'roles cleared',
            'invitations deleted',
            'preferences deleted',
            'settings deleted',
            'tenant closed'
        ]);
        expect(billing.closeForDeletion).toHaveBeenCalledWith('t1');
        // An operator erased earlier (e.g. by a data-subject request) is not touched again.
        expect(kratos.deleteIdentity).toHaveBeenCalledTimes(1);
        expect(kratos.deleteIdentity).toHaveBeenCalledWith('k-1');
        expect(tx.user!.update).toHaveBeenCalledWith({
            where: { id: 'U1' },
            data: expect.objectContaining({ email: 'erased-u1@erased.invalid', name: null, kratosIdentityId: 'erased:U1', status: 'disabled' })
        });
    });

    it('clears what identifies the tenant and announces tenant.deleted from the same transaction', async () => {
        await service.execute('t1', NOW);

        expect(tx.tenant!.update).toHaveBeenCalledWith({
            where: { id: 't1' },
            data: expect.objectContaining({ status: 'closed', deletedAt: NOW, name: 'Deleted tenant', slug: 'deleted-t1', customDomain: null })
        });
        expect(tx.apiKey!.updateMany).toHaveBeenCalledWith({ where: { tenantId: 't1', revokedAt: null }, data: { revokedAt: NOW, deletedAt: NOW } });
        const [name, event] = txEvents.emitAfterCommit.mock.calls[0]!;
        expect(name).toBe('tenant.deleted');
        expect(event).toBeInstanceOf(TenantDeletedEvent);
    });

    it.each([
        ['the deletion was cancelled', { deletionDueAt: null }],
        ['the deletion is not due yet', { deletionDueAt: new Date('2026-09-23T00:00:00Z') }],
        ['the tenant is already closed', { status: 'closed' }]
    ])('does nothing when %s', async (_case, overrides) => {
        (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(tenantRow(overrides));

        await expect(service.execute('t1', NOW)).resolves.toBe(false);
        expect(billing.closeForDeletion).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('leaves the tenant open when Stripe fails, so the next sweep retries the whole saga', async () => {
        billing.closeForDeletion.mockRejectedValue(new Error('stripe down'));

        await expect(service.execute('t1', NOW)).rejects.toThrow('stripe down');
        expect(kratos.deleteIdentity).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('sweeps only open tenants past their due date, oldest first', async () => {
        (prisma.tenant.findMany as jest.Mock).mockResolvedValue([{ id: 't1' }, { id: 't2' }]);

        await expect(service.findDue(NOW)).resolves.toEqual(['t1', 't2']);
        expect(prisma.tenant.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { deletionDueAt: { lte: NOW }, status: { not: 'closed' } }, orderBy: { deletionDueAt: 'asc' } })
        );
    });
});
