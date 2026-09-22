import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { KratosService } from '@common/auth/kratos.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { hashEmail } from '@common/helper/hashing';
import { RoleEnum } from '@common/enums/role.enum';
import type { IAuthenticatedUser } from '@app/types';

import { UsersService } from './users.service';

type Row = { id: string; tenantId: string; role: RoleEnum; kratosIdentityId: string; email: string; deletedAt: Date | null };

const TENANT = 'tenant-1';
const actorAs = (userId: string): IAuthenticatedUser => ({ userId, tenantId: TENANT, source: 'dashboard' });
const member = (id: string, role: RoleEnum, extra: Partial<Row> = {}): Row => ({
    id,
    tenantId: TENANT,
    role,
    kratosIdentityId: `kratos-${id}`,
    email: `${id}@acme.io`,
    deletedAt: null,
    ...extra
});

const expectStatus = async (action: Promise<unknown>, status: HttpStatus): Promise<void> => {
    const error = await action.then(
        () => undefined,
        (e: unknown) => e
    );
    expect(error).toBeInstanceOf(BaseException);
    expect((error as BaseException).getStatus()).toBe(status);
};

describe('UsersService — tenant membership', () => {
    let service: UsersService;
    let prisma: MockProxy<DatabaseService>;
    let tenantAware: MockProxy<TenantAwareService>;
    let kratos: MockProxy<KratosService>;
    let events: MockProxy<TransactionEventEmitterService>;
    let rows: Map<string, Row>;
    let tx: {
        user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
        role: { findUnique: jest.Mock };
        userRole: { deleteMany: jest.Mock; create: jest.Mock };
    };

    beforeEach(async () => {
        rows = new Map();
        prisma = mock<DatabaseService>();
        tenantAware = mock<TenantAwareService>();
        kratos = mock<KratosService>();
        events = mock<TransactionEventEmitterService>();

        tx = {
            user: {
                findUnique: jest.fn(
                    async ({ where }: { where: { kratosIdentityId: string } }) =>
                        [...rows.values()].find((r) => r.kratosIdentityId === where.kratosIdentityId) ?? null
                ),
                create: jest.fn(async ({ data }: { data: Omit<Row, 'id' | 'deletedAt'> }) => ({ id: 'new-user', deletedAt: null, ...data })),
                update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => ({ ...rows.get(where.id)!, ...data })),
                delete: jest.fn()
            },
            role: { findUnique: jest.fn(async ({ where }: { where: { name: string } }) => ({ id: `role-${where.name}` })) },
            userRole: { deleteMany: jest.fn(), create: jest.fn() }
        };
        (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx));
        (prisma as unknown as { user: unknown }).user = {
            findFirst: jest.fn(async ({ where }: { where: { id: string } }) => {
                const row = rows.get(where.id);
                return row && !row.deletedAt ? row : null;
            }),
            count: jest.fn(async () => [...rows.values()].filter((r) => !r.deletedAt && [RoleEnum.OWNER, RoleEnum.ADMIN].includes(r.role)).length)
        };
        tenantAware.forModel.mockReturnValue(prisma.user as never);
        kratos.revokeSessions.mockResolvedValue(undefined);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UsersService,
                { provide: DatabaseService, useValue: prisma },
                { provide: TenantAwareService, useValue: tenantAware },
                { provide: TransactionEventEmitterService, useValue: events },
                { provide: KratosService, useValue: kratos },
                { provide: AppLoggerService, useValue: mock<AppLoggerService>() }
            ]
        }).compile();

        service = module.get(UsersService);
    });

    const seed = (...members: Row[]): void => members.forEach((m) => rows.set(m.id, m));

    describe('given a brand-new tenant', () => {
        it('then the signing-up identity becomes its Owner, with a hashed email and a role projection, and user.registered is emitted', async () => {
            const owner = await service.createOwner(tx as never, TENANT, { identityId: 'kratos-9', email: 'Ada@Acme.io', name: 'Ada' });

            expect(tx.user.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    tenantId: TENANT,
                    kratosIdentityId: 'kratos-9',
                    role: RoleEnum.OWNER,
                    emailHash: hashEmail('ada@acme.io')
                })
            });
            expect(tx.userRole.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ userId: owner.id, roleId: `role-${RoleEnum.OWNER}` })
            });
            expect(events.emitAfterCommit).toHaveBeenCalledWith(
                'user.registered',
                expect.objectContaining({ tenantId: TENANT, role: RoleEnum.OWNER })
            );
        });
    });

    describe('given an identity that already belongs to a tenant', () => {
        it('then joining another tenant is refused — one identity, one tenant', async () => {
            seed(member('existing', RoleEnum.VIEWER, { kratosIdentityId: 'kratos-x' }));

            await expectStatus(
                service.joinByInvitation(tx as never, 'tenant-2', { identityId: 'kratos-x', email: 'x@acme.io' }, RoleEnum.VIEWER, null),
                HttpStatus.CONFLICT
            );
            expect(tx.user.create).not.toHaveBeenCalled();
        });

        it('then a previously removed membership frees the identity, and the old row is replaced', async () => {
            seed(member('gone', RoleEnum.VIEWER, { kratosIdentityId: 'kratos-x', deletedAt: new Date() }));

            await service.joinByInvitation(tx as never, 'tenant-2', { identityId: 'kratos-x', email: 'x@acme.io' }, RoleEnum.OPERATOR, null);

            expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'gone' } });
            expect(tx.user.create).toHaveBeenCalled();
        });
    });

    describe('when adding a member', () => {
        beforeEach(() => kratos.getIdentity.mockResolvedValue({ id: 'kratos-new', schema_id: 'default', traits: { email: 'new@acme.io' } }));

        it('then nobody can grant the Owner role directly', async () => {
            seed(member('owner', RoleEnum.OWNER));
            await expectStatus(service.addUser(actorAs('owner'), { kratosIdentityId: 'kratos-new', role: RoleEnum.OWNER }), HttpStatus.FORBIDDEN);
        });

        it('then an Operator cannot grant a role above their own', async () => {
            seed(member('op', RoleEnum.OPERATOR));
            await expectStatus(service.addUser(actorAs('op'), { kratosIdentityId: 'kratos-new', role: RoleEnum.ADMIN }), HttpStatus.FORBIDDEN);
        });

        it('then an Admin can add an Operator, taking the email from Ory rather than the request', async () => {
            seed(member('admin', RoleEnum.ADMIN));

            await service.addUser(actorAs('admin'), { kratosIdentityId: 'kratos-new', role: RoleEnum.OPERATOR });

            expect(tx.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: 'new@acme.io', role: RoleEnum.OPERATOR }) });
        });
    });

    describe('when changing a role', () => {
        it('then an Admin cannot demote another Admin — peers and superiors are out of reach', async () => {
            seed(member('owner', RoleEnum.OWNER), member('a1', RoleEnum.ADMIN), member('a2', RoleEnum.ADMIN));
            await expectStatus(service.updateRole(actorAs('a1'), 'a2', { role: RoleEnum.VIEWER }), HttpStatus.FORBIDDEN);
        });

        it('then nobody can change their own role', async () => {
            seed(member('owner', RoleEnum.OWNER));
            await expectStatus(service.updateRole(actorAs('owner'), 'owner', { role: RoleEnum.ADMIN }), HttpStatus.FORBIDDEN);
        });

        it('then the Owner can promote an Operator, replacing the projection and emitting user.role_changed', async () => {
            seed(member('owner', RoleEnum.OWNER), member('op', RoleEnum.OPERATOR));

            await service.updateRole(actorAs('owner'), 'op', { role: RoleEnum.ADMIN });

            expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'op' }, data: { role: RoleEnum.ADMIN } });
            expect(tx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'op' } });
            expect(events.emitAfterCommit).toHaveBeenCalledWith(
                'user.role_changed',
                expect.objectContaining({ oldRole: RoleEnum.OPERATOR, newRole: RoleEnum.ADMIN })
            );
        });
    });

    describe('when removing a member', () => {
        it('then the member is disabled, their role projection cleared, sessions revoked and user.removed emitted', async () => {
            seed(member('owner', RoleEnum.OWNER), member('op', RoleEnum.OPERATOR));

            await service.remove(actorAs('owner'), 'op');

            expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'op' }, data: { status: 'disabled', deletedAt: expect.any(Date) } });
            expect(tx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'op' } });
            expect(kratos.revokeSessions).toHaveBeenCalledWith('kratos-op');
            expect(events.emitAfterCommit).toHaveBeenCalledWith('user.removed', expect.objectContaining({ aggregateId: 'op', tenantId: TENANT }));
        });

        it('then the last Owner/Admin cannot be removed', async () => {
            seed(member('owner', RoleEnum.OWNER, { deletedAt: null }), member('admin', RoleEnum.ADMIN));
            rows.get('owner')!.deletedAt = null;
            (prisma.user.count as jest.Mock).mockResolvedValueOnce(1);

            await expectStatus(service.remove(actorAs('owner'), 'admin'), HttpStatus.CONFLICT);
        });
    });

    describe('when transferring ownership', () => {
        it('then only the Owner may do it', async () => {
            seed(member('owner', RoleEnum.OWNER), member('admin', RoleEnum.ADMIN));
            await expectStatus(service.transferOwnership(actorAs('admin'), 'owner'), HttpStatus.FORBIDDEN);
        });

        it('then the new Owner is promoted and the old Owner becomes an Admin in one transaction', async () => {
            seed(member('owner', RoleEnum.OWNER), member('op', RoleEnum.OPERATOR));

            await service.transferOwnership(actorAs('owner'), 'op');

            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'op' }, data: { role: RoleEnum.OWNER } });
            expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'owner' }, data: { role: RoleEnum.ADMIN } });
        });
    });
});
