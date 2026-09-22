import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import { TenantService } from './tenant.service';
import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DateService } from '@common/helper/date.service';
import { KratosService } from '@common/auth/kratos.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { SubdomainService } from '../dns/subdomain.service';
import { DnsVerificationService } from '../dns/dns-verification.service';
import { FilesService } from '../files/files.service';
import { UsersService } from '../users/users.service';

import moment from 'moment';

/**
 * Signup used to create a tenant with no owner user, no role and no Keto grants, and a replayed Kratos
 * web hook created a duplicate tenant. Onboarding now creates tenant + Owner in one transaction and is
 * deduplicated on the Ory identity.
 */
describe('TenantService.create — tenant onboarding', () => {
    let service: TenantService;
    let prisma: MockProxy<DatabaseService>;
    let users: MockProxy<UsersService>;
    let events: MockProxy<TransactionEventEmitterService>;
    let tx: { tenant: { create: jest.Mock }; tenantVerification: { create: jest.Mock } };
    const owner = { identityId: 'kratos-1', email: 'ada@acme.io', name: 'Ada' };

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        users = mock<UsersService>();
        events = mock<TransactionEventEmitterService>();
        tx = {
            tenant: {
                create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, createdAt: new Date(), updatedAt: new Date() }))
            },
            tenantVerification: { create: jest.fn().mockResolvedValue({ id: 'verif-1' }) }
        };
        (prisma as unknown as { user: unknown }).user = { findUnique: jest.fn().mockResolvedValue(null) };
        (prisma as unknown as { tenant: unknown }).tenant = { count: jest.fn().mockResolvedValue(0), findUnique: jest.fn() };
        (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx));
        users.createOwner.mockResolvedValue({ id: 'user-owner', tenantId: 'x' } as never);
        const dates = mock<DateService>();
        dates.nowMoment.mockImplementation(() => moment());

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantService,
                { provide: DatabaseService, useValue: prisma },
                { provide: TenantContextService, useValue: mock<TenantContextService>() },
                { provide: TransactionEventEmitterService, useValue: events },
                { provide: AppLoggerService, useValue: mock<AppLoggerService>() },
                { provide: DateService, useValue: dates },
                { provide: SubdomainService, useValue: mock<SubdomainService>() },
                { provide: DnsVerificationService, useValue: mock<DnsVerificationService>() },
                { provide: FilesService, useValue: mock<FilesService>() },
                { provide: KratosService, useValue: mock<KratosService>() },
                { provide: ConfigService, useValue: mock<ConfigService>() },
                { provide: UsersService, useValue: users }
            ]
        }).compile();

        service = module.get(TenantService);
    });

    describe('given an identity with no tenant', () => {
        it('then the tenant and its Owner are created in the same transaction, and tenant.created is emitted', async () => {
            const tenant = await service.create({ name: 'Acme' }, owner, { onExisting: 'conflict' });

            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(tx.tenant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'Acme', status: 'active' }) });
            expect(users.createOwner).toHaveBeenCalledWith(tx, tenant.id, owner);
            expect(events.emitAfterCommit).toHaveBeenCalledWith('tenant.created', expect.objectContaining({ tenantId: tenant.id }));
            expect(events.emitAfterCommit).toHaveBeenCalledWith(
                'tenant.verification_requested',
                expect.objectContaining({ tenantId: tenant.id, verificationId: 'verif-1' })
            );
        });

        it('then its company verification is opened in the same transaction and the tenant shows as pending', async () => {
            const tenant = await service.create({ name: 'Acme' }, owner, { onExisting: 'conflict' });

            expect(tx.tenantVerification.create).toHaveBeenCalledWith({ data: { tenantId: tenant.id, verificationType: 'company' } });
            expect(tx.tenant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ verificationStatus: 'pending' }) });
        });

        it('then a taken slug is refused with 409 before anything is written', async () => {
            (prisma.tenant.count as jest.Mock).mockResolvedValue(1);
            const error = await service.create({ name: 'Acme', slug: 'acme' }, owner, { onExisting: 'conflict' }).catch((e: BaseException) => e);
            expect((error as BaseException).getStatus()).toBe(HttpStatus.CONFLICT);
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });
    });

    describe('given an identity that already owns a tenant', () => {
        beforeEach(() => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ tenantId: 'tenant-existing', deletedAt: null });
            (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 'tenant-existing', name: 'Acme', slug: 'acme', deletedAt: null });
        });

        it('then a replayed signup hook gets the existing tenant back and nothing is created', async () => {
            const tenant = await service.create({ name: 'Acme' }, owner, { onExisting: 'return' });
            expect(tenant.id).toBe('tenant-existing');
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });

        it('then asking for a second tenant is refused with 409', async () => {
            const error = await service.create({ name: 'Other' }, owner, { onExisting: 'conflict' }).catch((e: BaseException) => e);
            expect((error as BaseException).getStatus()).toBe(HttpStatus.CONFLICT);
        });
    });
});
