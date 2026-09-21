import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';
import { ConflictException, BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { sha256Hex } from '@common/helper/hashing';
import { InvitationStatusEnum } from '@common/enums/invitation.enum';
import { RoleEnum } from '@common/enums/role.enum';
import type { IAuthenticatedUser } from '@app/types';

import { UsersService } from '@app/features/users/users.service';

import { InvitationService } from './invitation.service';

describe('InvitationService', () => {
    let service: InvitationService;
    let prisma: MockProxy<DatabaseService>;
    let tenantAware: MockProxy<TenantAwareService>;
    let txEventEmitter: MockProxy<TransactionEventEmitterService>;
    let usersService: MockProxy<UsersService>;
    let delegate: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    let tx: { invitation: { updateMany: jest.Mock; create: jest.Mock } };

    const tenantId = 'tenant-123';
    const TOKEN = 'tok-1';
    const admin: IAuthenticatedUser = { userId: 'admin-1', tenantId, source: 'dashboard' };
    const pending = {
        id: 'inv-1',
        tenantId,
        email: 'invitee@acme.com',
        role: RoleEnum.OPERATOR,
        status: InvitationStatusEnum.PENDING,
        tokenHash: sha256Hex(TOKEN),
        expiresAt: new Date(Date.now() + 86_400_000),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
    };

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        tenantAware = mock<TenantAwareService>();
        txEventEmitter = mock<TransactionEventEmitterService>();
        usersService = mock<UsersService>();

        delegate = { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() };
        tx = { invitation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() } };
        tenantAware.forModel.mockReturnValue(delegate as never);
        tx.invitation.create = delegate.create;
        tenantAware.withTenantFilter.mockImplementation((w) => ({ ...w, tenantId }) as never);
        prisma.invitation = { findUnique: jest.fn(), update: jest.fn() } as never;
        (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx));
        usersService.roleOf.mockResolvedValue(RoleEnum.ADMIN);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                InvitationService,
                { provide: DatabaseService, useValue: prisma },
                { provide: TenantAwareService, useValue: tenantAware },
                { provide: TransactionEventEmitterService, useValue: txEventEmitter },
                { provide: UsersService, useValue: usersService },
                { provide: AppLoggerService, useValue: mock<AppLoggerService>() }
            ]
        }).compile();

        service = module.get(InvitationService);
    });

    describe('when an Admin invites someone', () => {
        it('then only a hash of the token is stored, and invitation.created and user.invited are emitted', async () => {
            delegate.findFirst.mockResolvedValue(null);
            delegate.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...pending, ...data }));

            await service.create(admin, { email: 'invitee@acme.com', role: RoleEnum.OPERATOR });

            const { data } = delegate.create.mock.calls[0][0] as { data: Record<string, unknown> };
            expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
            expect(data).not.toHaveProperty('token');
            const created = txEventEmitter.emitAfterCommit.mock.calls.find(([name]) => name === 'invitation.created')![1] as {
                payload: { token: string };
            };
            expect(sha256Hex(created.payload.token)).toBe(data.tokenHash);
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalledWith(
                'user.invited',
                expect.objectContaining({ aggregateId: 'inv-1', role: RoleEnum.OPERATOR })
            );
        });

        it('then inviting at a rank above the inviter is refused', async () => {
            usersService.roleOf.mockResolvedValue(RoleEnum.OPERATOR);
            await expect(service.create(admin, { email: 'x@acme.com', role: RoleEnum.ADMIN })).rejects.toBeInstanceOf(BaseException);
            expect(delegate.create).not.toHaveBeenCalled();
        });

        it('then nobody can invite an Owner', async () => {
            usersService.roleOf.mockResolvedValue(RoleEnum.OWNER);
            await expect(service.create(admin, { email: 'x@acme.com', role: RoleEnum.OWNER })).rejects.toBeInstanceOf(BaseException);
        });

        it('then a duplicate pending invitation for the same email is rejected', async () => {
            delegate.findFirst.mockResolvedValue(pending);
            await expect(service.create(admin, { email: 'invitee@acme.com', role: RoleEnum.OPERATOR })).rejects.toBeInstanceOf(ConflictException);
        });
    });

    describe('when the invitee accepts', () => {
        const invitee: IAuthenticatedUser = { userId: '', tenantId: '', identityId: 'kratos-1', source: 'dashboard' };
        const joined = { id: 'user-1', tenantId, email: 'invitee@acme.com', role: RoleEnum.OPERATOR, kratosIdentityId: 'kratos-1' };

        beforeEach(() => {
            (prisma.invitation.findUnique as jest.Mock).mockResolvedValue(pending);
            usersService.identityOf.mockResolvedValue({ identityId: 'kratos-1', email: 'Invitee@Acme.com' });
            usersService.joinByInvitation.mockResolvedValue(joined as never);
        });

        it('then the invitation is looked up by the token hash, claimed and the membership created in one transaction', async () => {
            const result = await service.accept(TOKEN, invitee);

            expect(prisma.invitation.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256Hex(TOKEN) } });
            expect(tx.invitation.updateMany).toHaveBeenCalledWith({
                where: { id: 'inv-1', status: InvitationStatusEnum.PENDING },
                data: { status: InvitationStatusEnum.ACCEPTED }
            });
            expect(usersService.joinByInvitation).toHaveBeenCalledWith(
                tx,
                tenantId,
                { identityId: 'kratos-1', email: 'Invitee@Acme.com' },
                RoleEnum.OPERATOR,
                null
            );
            expect(result.id).toBe('user-1');
        });

        it('then a second, concurrent acceptance of the same invitation is refused', async () => {
            tx.invitation.updateMany.mockResolvedValue({ count: 0 });
            const error = await service.accept(TOKEN, invitee).catch((e: BaseException) => e);
            expect((error as BaseException).getStatus()).toBe(HttpStatus.CONFLICT);
            expect(usersService.joinByInvitation).not.toHaveBeenCalled();
        });

        it('then an identity whose Ory email differs from the invitation is refused', async () => {
            usersService.identityOf.mockResolvedValue({ identityId: 'kratos-1', email: 'someone@else.com' });
            const error = await service.accept(TOKEN, invitee).catch((e: BaseException) => e);
            expect((error as BaseException).getStatus()).toBe(HttpStatus.FORBIDDEN);
            expect(usersService.joinByInvitation).not.toHaveBeenCalled();
        });

        it('then an expired invitation is marked EXPIRED and rejected', async () => {
            (prisma.invitation.findUnique as jest.Mock).mockResolvedValue({ ...pending, expiresAt: new Date(Date.now() - 1000) });
            await expect(service.accept(TOKEN, invitee)).rejects.toBeInstanceOf(BadRequestException);
            expect(prisma.invitation.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: InvitationStatusEnum.EXPIRED } });
        });

        it('then an unknown token is rejected', async () => {
            (prisma.invitation.findUnique as jest.Mock).mockResolvedValue(null);
            await expect(service.accept('nope', invitee)).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('resend / revoke', () => {
        it('then resend stores the hash of a fresh token and emits invitation.resent', async () => {
            delegate.findUnique.mockResolvedValue(pending);
            delegate.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...pending, ...data }));

            await service.resend('inv-1', 'actor-1');

            const { data } = delegate.update.mock.calls[0][0] as { data: { tokenHash: string } };
            expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
            expect(data.tokenHash).not.toBe(pending.tokenHash);
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalledWith('invitation.resent', expect.anything());
        });

        it('then revoke sets the invitation status to REVOKED', async () => {
            delegate.findUnique.mockResolvedValue(pending);
            delegate.update.mockResolvedValue({ ...pending, status: InvitationStatusEnum.REVOKED });

            await service.revoke('inv-1', 'actor-1');

            expect(delegate.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: InvitationStatusEnum.REVOKED } });
        });
    });
});
