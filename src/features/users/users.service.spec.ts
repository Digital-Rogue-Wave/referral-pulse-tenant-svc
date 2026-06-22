import { Test, TestingModule } from '@nestjs/testing';
import { mock, MockProxy } from 'jest-mock-extended';
import { ConflictException } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RoleEnum } from '@common/enums/role.enum';

import { UsersService } from './users.service';

describe('UsersService.provisionMember', () => {
    let service: UsersService;
    let prisma: MockProxy<DatabaseService>;
    let txEventEmitter: MockProxy<TransactionEventEmitterService>;

    const tenantId = 'tenant-123';
    const saved = {
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

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        txEventEmitter = mock<TransactionEventEmitterService>();

        prisma.user = { findUnique: jest.fn(), create: jest.fn() } as never;
        prisma.role = { findUnique: jest.fn() } as never;
        prisma.userRole = { upsert: jest.fn(), deleteMany: jest.fn() } as never;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UsersService,
                { provide: DatabaseService, useValue: prisma },
                { provide: TenantAwareService, useValue: mock<TenantAwareService>() },
                { provide: TransactionEventEmitterService, useValue: txEventEmitter },
                { provide: AppLoggerService, useValue: mock<AppLoggerService>() }
            ]
        }).compile();

        service = module.get(UsersService);
    });

    it('creates the membership, assigns the role, and emits user.registered', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.user.create as jest.Mock).mockResolvedValue(saved);
        (prisma.role.findUnique as jest.Mock).mockResolvedValue({ id: 'role-1' });

        const result = await service.provisionMember({
            tenantId,
            kratosIdentityId: 'kratos-1',
            email: 'invitee@acme.com',
            role: RoleEnum.OPERATOR,
            actingUserId: 'actor-1'
        });

        expect(result.id).toBe('user-1');
        const createArg = (prisma.user.create as jest.Mock).mock.calls[0][0];
        expect(createArg.data).toEqual(expect.objectContaining({ tenantId, kratosIdentityId: 'kratos-1', role: RoleEnum.OPERATOR }));
        expect(prisma.userRole.upsert).toHaveBeenCalled();
        expect(txEventEmitter.emitAfterCommit).toHaveBeenCalledWith('user.registered', expect.anything());
    });

    it('rejects when the identity is already a member of the tenant', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(saved);

        await expect(service.provisionMember({ tenantId, kratosIdentityId: 'kratos-1', role: RoleEnum.OPERATOR })).rejects.toBeInstanceOf(
            ConflictException
        );
        expect(prisma.user.create).not.toHaveBeenCalled();
    });
});
