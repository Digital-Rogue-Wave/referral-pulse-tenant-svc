import { HttpStatus } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { RoleEnum } from '@common/enums/role.enum';

import { InvitationService } from '../invitation/invitation.service';
import { AdminTenantService } from './admin-tenant.service';
import { TenantService } from './tenant.service';

/** US1.1.1: a Super Admin creates a client tenant from the platform console and invites its Owner. */
describe('AdminTenantService.create — tenant provisioning by a platform admin', () => {
    const tx = { marker: 'tx' };
    const now = new Date('2026-11-09T00:00:00Z');
    let service: AdminTenantService;
    let tenants: MockProxy<TenantService>;
    let invitations: MockProxy<InvitationService>;
    let events: MockProxy<TransactionEventEmitterService>;

    beforeEach(() => {
        const prisma = mock<DatabaseService>();
        (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx));
        tenants = mock<TenantService>();
        invitations = mock<InvitationService>();
        events = mock<TransactionEventEmitterService>();
        tenants.freeSlug.mockResolvedValue('acme');
        tenants.insertTenant.mockImplementation(async (_tx, params) => ({
            tenant: { id: params.id, name: params.name, slug: params.slug, status: 'active', createdAt: now, updatedAt: now } as never,
            verificationId: 'verif-1'
        }));
        invitations.issue.mockImplementation(
            async (_tx, params) =>
                ({
                    id: 'inv-1',
                    tenantId: params.tenantId,
                    email: params.email,
                    role: params.role,
                    status: 'PENDING',
                    tokenHash: 'hash',
                    expiresAt: now,
                    createdAt: now
                }) as never
        );
        service = new AdminTenantService(prisma, tenants, invitations, events, mock<AppLoggerService>());
    });

    it('creates the tenant with no Owner and an OWNER invitation in one transaction, both attributed to the admin', async () => {
        const result = await service.create({ name: 'Acme', ownerEmail: 'owner@acme.com' }, 'admin-1');

        const [insertTx, inserted] = tenants.insertTenant.mock.calls[0]!;
        expect(insertTx).toBe(tx);
        expect(inserted).toMatchObject({ name: 'Acme', slug: 'acme', ownerIdentityId: null, actingUserId: 'admin-1' });
        expect(invitations.issue).toHaveBeenCalledWith(tx, {
            tenantId: inserted.id,
            email: 'owner@acme.com',
            role: RoleEnum.OWNER,
            actingUserId: 'admin-1'
        });
        expect(events.emitAfterCommit).toHaveBeenCalledWith(
            'tenant.verification_requested',
            expect.objectContaining({ tenantId: inserted.id, userId: 'admin-1', verificationId: 'verif-1' })
        );
        expect(result.tenant).toMatchObject({ id: inserted.id, name: 'Acme', slug: 'acme' });
        expect(result.ownerInvitation).toMatchObject({ email: 'owner@acme.com', role: RoleEnum.OWNER, status: 'PENDING' });
    });

    it('writes nothing when the slug is taken', async () => {
        tenants.freeSlug.mockRejectedValue(new BaseException('duplicate_resource', 'Slug "acme" is already in use', HttpStatus.CONFLICT, 'slug'));

        await expect(service.create({ name: 'Acme', slug: 'acme', ownerEmail: 'owner@acme.com' }, 'admin-1')).rejects.toMatchObject({
            status: HttpStatus.CONFLICT
        });
        expect(tenants.insertTenant).not.toHaveBeenCalled();
        expect(invitations.issue).not.toHaveBeenCalled();
    });
});
