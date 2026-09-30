import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';
import moment from 'moment';

import { DatabaseService } from '@app/database/database.service';
import { KratosService } from '@common/auth/kratos.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import type { IAuthenticatedUser } from '@app/types';

import { DnsVerificationService } from '../dns/dns-verification.service';
import { SubdomainService } from '../dns/subdomain.service';
import { FilesService } from '../files/files.service';
import { UsersService } from '../users/users.service';
import { TenantService } from './tenant.service';

const OWNER: IAuthenticatedUser = { userId: 'u1', tenantId: 't1', source: 'dashboard' };

const tenantRow = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    name: 'Acme',
    slug: 'acme',
    status: 'active',
    verificationStatus: 'verified',
    paymentStatus: 'active',
    retentionMonths: 24,
    dataRegion: 'eu-central-1',
    customDomain: null,
    domainVerificationStatus: 'unverified',
    domainVerificationToken: null,
    imageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides
});

describe('TenantService — tenant lifecycle', () => {
    let prisma: { tenant: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock }; $transaction: jest.Mock };
    let events: MockProxy<TransactionEventEmitterService>;
    let files: MockProxy<FilesService>;
    let dns: MockProxy<DnsVerificationService>;
    let subdomains: MockProxy<SubdomainService>;
    let users: MockProxy<UsersService>;
    let customDomains: boolean;
    let service: TenantService;

    const emitted = (): string[] => events.emitAfterCommit.mock.calls.map(([name]) => name);

    beforeEach(() => {
        prisma = {
            tenant: {
                findUnique: jest.fn().mockResolvedValue(tenantRow()),
                findMany: jest.fn().mockResolvedValue([]),
                update: jest.fn(async ({ data }: { data: object }) => tenantRow(data as Record<string, unknown>))
            },
            $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma))
        };
        events = mock<TransactionEventEmitterService>();
        files = mock<FilesService>();
        dns = mock<DnsVerificationService>();
        subdomains = mock<SubdomainService>();
        users = mock<UsersService>();
        customDomains = false;
        const context = mock<TenantContextService>();
        context.getTenantId.mockReturnValue('t1');
        const dates = mock<DateService>();
        dates.nowMoment.mockImplementation(() => moment('2026-09-22T00:00:00Z'));
        const config = mock<ConfigService>();
        config.get.mockImplementation(() => customDomains);
        service = new TenantService(
            prisma as unknown as DatabaseService,
            context,
            events,
            mock<AppLoggerService>(),
            dates,
            subdomains,
            dns,
            files,
            mock<KratosService>(),
            users,
            config as never
        );
    });

    describe('reading', () => {
        it('returns the profile, the domain status and subdomain availability', async () => {
            await expect(service.getProfile()).resolves.toMatchObject({ id: 't1', name: 'Acme' });
            await expect(service.getDomainStatus()).resolves.toEqual({
                customDomain: null,
                domainVerificationStatus: 'unverified',
                domainVerificationToken: undefined
            });
            subdomains.checkSubdomain.mockResolvedValue({ available: false, message: 'taken' } as never);
            await expect(service.checkSubdomainAvailability('acme')).resolves.toEqual({ subdomain: 'acme', available: false, message: 'taken' });
        });

        it('is 404 for a missing or deleted tenant', async () => {
            prisma.tenant.findUnique.mockResolvedValue(null);
            await expect(service.getProfile()).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('updating', () => {
        it('records only what changed and announces it', async () => {
            await service.update({ name: 'Acme GmbH', retentionMonths: 12 }, OWNER);

            expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { name: 'Acme GmbH', retentionMonths: 12 } });
            const [, event] = events.emitAfterCommit.mock.calls[0]!;
            expect(event).toMatchObject({ changes: { name: { from: 'Acme', to: 'Acme GmbH' }, retentionMonths: { from: 24, to: 12 } } });
        });

        it('writes nothing when nothing changed', async () => {
            await service.update({ name: 'Acme' }, OWNER);
            expect(prisma.tenant.update).not.toHaveBeenCalled();
        });

        it('keeps the update when the logo upload fails', async () => {
            files.uploadFile.mockRejectedValue(new Error('s3 down'));
            await service.update({ name: 'New' }, OWNER, {} as Express.Multer.File);
            expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { name: 'New' } });
        });

        it('stores an uploaded logo', async () => {
            files.uploadFile.mockResolvedValue({ id: 'file_1' } as never);
            await service.update({}, OWNER, {} as Express.Multer.File);
            expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { imageId: 'file_1' } });
        });
    });

    describe('custom domains', () => {
        it('are refused while the feature is off (they could not be served)', async () => {
            const error = await service.update({ customDomain: 'refer.acme.io' }, OWNER).catch((e: BaseException) => e);
            expect((error as BaseException).getStatus()).toBe(HttpStatus.CONFLICT);
            await expect(service.verifyCustomDomain()).rejects.toBeInstanceOf(BaseException);
        });

        it('get a verification token when set, and are verified from the DNS TXT record', async () => {
            customDomains = true;
            await service.update({ customDomain: 'refer.acme.io' }, OWNER);
            expect(prisma.tenant.update.mock.calls[0]![0].data).toMatchObject({ customDomain: 'refer.acme.io', domainVerificationStatus: 'pending' });

            prisma.tenant.findUnique.mockResolvedValue(tenantRow({ customDomain: 'refer.acme.io', domainVerificationToken: 'tok' }));
            dns.verifyTxtRecord.mockResolvedValue({ verified: true } as never);
            await service.verifyCustomDomain();
            expect(emitted()).toContain('tenant.domain-verified');

            events.emitAfterCommit.mockClear();
            dns.verifyTxtRecord.mockResolvedValue({ verified: false } as never);
            await service.verifyCustomDomain();
            expect(prisma.tenant.update).toHaveBeenLastCalledWith({ where: { id: 't1' }, data: { domainVerificationStatus: 'failed' } });
            expect(events.emitAfterCommit).not.toHaveBeenCalled();
        });

        it('cannot be verified without a domain or a token', async () => {
            customDomains = true;
            await expect(service.verifyCustomDomain()).rejects.toBeInstanceOf(BadRequestException);
            prisma.tenant.findUnique.mockResolvedValue(tenantRow({ customDomain: 'refer.acme.io' }));
            await expect(service.verifyCustomDomain()).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('deletion', () => {
        it('schedules the deletion with its due date (default 30 days) and announces it', async () => {
            const result = await service.scheduleDeletion({ reason: 'closing' }, OWNER);

            const data = prisma.tenant.update.mock.calls[0]![0].data;
            expect(data.deletionDueAt).toEqual(moment('2026-09-22T00:00:00Z').add(30, 'days').toDate());
            expect(result.deletionDueAt).toEqual(data.deletionDueAt);
            expect(emitted()).toEqual(['tenant.deletion-scheduled']);
        });

        it('cancels a scheduled deletion', async () => {
            await service.cancelDeletion({}, OWNER);
            expect(prisma.tenant.update).toHaveBeenCalledWith({
                where: { id: 't1' },
                data: { deletionScheduledAt: null, deletionDueAt: null, deletionReason: null }
            });
            expect(emitted()).toEqual(['tenant.deletion-cancelled']);
        });
    });

    describe('platform actions', () => {
        it('suspends and unsuspends, refusing a no-op', async () => {
            await service.suspend('t1', 'fraud');
            expect(emitted()).toEqual(['tenant.suspended']);
            prisma.tenant.findUnique.mockResolvedValue(tenantRow({ status: 'suspended' }));
            await expect(service.suspend('t1', 'again')).rejects.toBeInstanceOf(BadRequestException);
            await service.unsuspend('t1');
            prisma.tenant.findUnique.mockResolvedValue(tenantRow());
            await expect(service.unsuspend('t1')).rejects.toBeInstanceOf(BadRequestException);
        });

        it('locks any tenant as a platform admin, optionally until a date, and unlocks it', async () => {
            const until = new Date('2026-10-01T00:00:00Z');
            await service.lockAsAdmin('t1', 'chargeback investigation', until, 'admin-1');
            expect(prisma.tenant.update.mock.calls[0]![0].data).toMatchObject({
                status: 'locked',
                lockUntil: until,
                lockReason: 'chargeback investigation'
            });

            prisma.tenant.findUnique.mockResolvedValue(tenantRow({ status: 'locked' }));
            await service.unlockAsAdmin('t1', 'admin-1');
            expect(emitted()).toEqual(['tenant.locked', 'tenant.unlocked']);
        });

        it('refuses to lock a closed tenant or unlock one that is not locked', async () => {
            prisma.tenant.findUnique.mockResolvedValue(tenantRow({ status: 'closed' }));
            await expect(service.lockAsAdmin('t1', 'x', null, 'admin-1')).rejects.toBeInstanceOf(BaseException);
            prisma.tenant.findUnique.mockResolvedValue(tenantRow());
            await expect(service.unlockAsAdmin('t1', 'admin-1')).rejects.toBeInstanceOf(BaseException);
        });

        it('unlocks timed locks once they expire', async () => {
            prisma.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);

            await expect(service.unlockExpired(new Date('2026-10-02T00:00:00Z'))).resolves.toBe(2);
            expect(prisma.tenant.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { status: 'locked', lockUntil: { lte: new Date('2026-10-02T00:00:00Z') } } })
            );
            expect(emitted()).toEqual(['tenant.unlocked', 'tenant.unlocked']);
        });

        it('delegates ownership transfer to the membership service', async () => {
            await service.transferOwnership({ newOwnerId: 'u2' }, OWNER);
            expect(users.transferOwnership).toHaveBeenCalledWith(OWNER, 'u2');
        });
    });
});
