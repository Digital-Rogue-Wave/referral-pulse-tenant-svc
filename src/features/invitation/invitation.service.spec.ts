import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';
import { ConflictException, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
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

    const tenantId = 'tenant-123';
    const pending = {
        id: 'inv-1',
        tenantId,
        email: 'invitee@acme.com',
        role: RoleEnum.OPERATOR,
        status: InvitationStatusEnum.PENDING,
        token: 'tok-1',
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
        tenantAware.forModel.mockReturnValue(delegate as never);
        tenantAware.withTenantFilter.mockImplementation((w) => ({ ...w, tenantId }) as never);
        prisma.invitation = { findUnique: jest.fn(), update: jest.fn() } as never;

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

    describe('create', () => {
        it('creates a pending invitation with a token and emits invitation.created', async () => {
            delegate.findFirst.mockResolvedValue(null);
            delegate.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...pending, ...data }));

            const result = await service.create('actor-1', { email: 'invitee@acme.com', role: RoleEnum.OPERATOR });

            expect(result.email).toBe('invitee@acme.com');
            const createArg = delegate.create.mock.calls[0][0];
            expect(createArg.data.status).toBe(InvitationStatusEnum.PENDING);
            expect(createArg.data.token).toEqual(expect.any(String));
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalledWith('invitation.created', expect.anything());
        });

        it('rejects a duplicate pending invitation for the same email', async () => {
            delegate.findFirst.mockResolvedValue(pending);
            await expect(service.create('actor-1', { email: 'invitee@acme.com', role: RoleEnum.OPERATOR })).rejects.toBeInstanceOf(ConflictException);
        });
    });

    describe('accept', () => {
        const authUser = { userId: 'kratos-1', tenantId: '', email: 'invitee@acme.com' } as IAuthenticatedUser;
        const member = {
            id: 'user-1',
            tenantId,
            email: 'invitee@acme.com',
            name: null,
            role: RoleEnum.OPERATOR,
            kratosIdentityId: 'kratos-1',
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        it('provisions the membership and marks the invitation accepted', async () => {
            (prisma.invitation.findUnique as jest.Mock).mockResolvedValue(pending);
            usersService.provisionMember.mockResolvedValue(member as never);

            const result = await service.accept('tok-1', authUser);

            expect(usersService.provisionMember).toHaveBeenCalledWith(
                expect.objectContaining({ tenantId, kratosIdentityId: 'kratos-1', role: RoleEnum.OPERATOR })
            );
            expect(prisma.invitation.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: InvitationStatusEnum.ACCEPTED } });
            expect(result.id).toBe('user-1');
        });

        it('rejects acceptance when the authenticated email differs from the invite', async () => {
            (prisma.invitation.findUnique as jest.Mock).mockResolvedValue(pending);
            await expect(service.accept('tok-1', { ...authUser, email: 'someone@else.com' })).rejects.toBeInstanceOf(ForbiddenException);
            expect(usersService.provisionMember).not.toHaveBeenCalled();
        });

        it('marks an expired invitation EXPIRED and rejects', async () => {
            (prisma.invitation.findUnique as jest.Mock).mockResolvedValue({ ...pending, expiresAt: new Date(Date.now() - 1000) });
            await expect(service.accept('tok-1', authUser)).rejects.toBeInstanceOf(BadRequestException);
            expect(prisma.invitation.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: InvitationStatusEnum.EXPIRED } });
        });

        it('rejects an unknown token', async () => {
            (prisma.invitation.findUnique as jest.Mock).mockResolvedValue(null);
            await expect(service.accept('nope', authUser)).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('resend / revoke', () => {
        it('resend issues a fresh token and emits invitation.resent', async () => {
            delegate.findUnique.mockResolvedValue(pending);
            delegate.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...pending, ...data }));

            await service.resend('inv-1', 'actor-1');

            const updateArg = delegate.update.mock.calls[0][0];
            expect(updateArg.data.token).toEqual(expect.any(String));
            expect(updateArg.data.token).not.toBe('tok-1');
            expect(txEventEmitter.emitAfterCommit).toHaveBeenCalledWith('invitation.resent', expect.anything());
        });

        it('revoke sets the invitation status to REVOKED', async () => {
            delegate.findUnique.mockResolvedValue(pending);
            delegate.update.mockResolvedValue({ ...pending, status: InvitationStatusEnum.REVOKED });

            await service.revoke('inv-1', 'actor-1');

            expect(delegate.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: InvitationStatusEnum.REVOKED } });
        });
    });
});
