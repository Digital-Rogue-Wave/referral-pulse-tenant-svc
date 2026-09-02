import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';

import { TenantService } from './tenant.service';
import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DateService } from '@common/helper/date.service';
import { KratosService } from '@common/auth/kratos.service';
import { SubdomainService } from '../dns/subdomain.service';
import { DnsVerificationService } from '../dns/dns-verification.service';
import { FilesService } from '../files/files.service';

import type { IAuthenticatedUser } from '@app/types';

/**
 * `BILLING.md` marked "require password confirmation via Ory (REFER-353)" as done,
 * but `KratosService.verifyPassword` had zero callers repo-wide — lock and unlock
 * did a bare `prisma.tenant.update`. Locking a tenant is destructive and not
 * self-service reversible, so a valid session alone was the only thing standing in
 * front of it.
 *
 * Note the JWT carries the *application* user id, so the Kratos identity has to be
 * resolved from `users.kratos_identity_id` first — mixing those up would send a
 * lookup key Kratos cannot resolve and silently fail open if the result were not
 * checked.
 */
describe('TenantService — password confirmation on destructive actions', () => {
    let service: TenantService;
    let prisma: MockProxy<DatabaseService>;
    let kratos: MockProxy<KratosService>;
    let tenantContext: MockProxy<TenantContextService>;

    const user: IAuthenticatedUser = { userId: 'usr_app_1', tenantId: 'ten_1' };
    const KRATOS_ID = 'kratos-identity-abc';

    const expectUnauthorized = async (action: Promise<unknown>): Promise<void> => {
        await expect(action).rejects.toThrow(HttpException);
        await action.catch((e: HttpException) => {
            expect(e.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
            expect((e.getResponse() as { code: string }).code).toBe('authentication_error');
        });
    };

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        (prisma as unknown as { user: unknown }).user = { findFirst: jest.fn() };
        (prisma as unknown as { tenant: unknown }).tenant = { update: jest.fn().mockResolvedValue({ id: 'ten_1', lockedAt: new Date() }) };

        kratos = mock<KratosService>();
        tenantContext = mock<TenantContextService>();
        tenantContext.getTenantId.mockReturnValue('ten_1');

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantService,
                { provide: DatabaseService, useValue: prisma },
                { provide: TenantContextService, useValue: tenantContext },
                { provide: TransactionEventEmitterService, useValue: mock<TransactionEventEmitterService>() },
                { provide: AppLoggerService, useValue: mock<AppLoggerService>() },
                { provide: DateService, useValue: mock<DateService>() },
                { provide: SubdomainService, useValue: mock<SubdomainService>() },
                { provide: DnsVerificationService, useValue: mock<DnsVerificationService>() },
                { provide: FilesService, useValue: mock<FilesService>() },
                { provide: KratosService, useValue: kratos }
            ]
        }).compile();

        service = module.get<TenantService>(TenantService);
    });

    describe('lock', () => {
        it('resolves the Kratos identity from the application user id, scoped to the tenant', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ kratosIdentityId: KRATOS_ID });
            kratos.verifyPassword.mockResolvedValue(true);

            await service.lock({ reason: 'suspected compromise', password: 'correct-horse' }, user);

            expect(prisma.user.findFirst).toHaveBeenCalledWith({
                where: { id: 'usr_app_1', tenantId: 'ten_1', deletedAt: null },
                select: { kratosIdentityId: true }
            });
            expect(kratos.verifyPassword).toHaveBeenCalledWith(KRATOS_ID, 'correct-horse');
        });

        it('locks the tenant once the password is confirmed', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ kratosIdentityId: KRATOS_ID });
            kratos.verifyPassword.mockResolvedValue(true);

            await service.lock({ reason: 'suspected compromise', password: 'correct-horse' }, user);

            expect(prisma.tenant.update).toHaveBeenCalled();
        });

        it('rejects with 401 and does not touch the tenant when the password is wrong', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ kratosIdentityId: KRATOS_ID });
            kratos.verifyPassword.mockResolvedValue(false);

            await expectUnauthorized(service.lock({ reason: 'r', password: 'wrong' }, user));
            expect(prisma.tenant.update).not.toHaveBeenCalled();
        });

        it('rejects when the user has no Kratos identity, rather than skipping the check', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ kratosIdentityId: null });

            await expectUnauthorized(service.lock({ reason: 'r', password: 'p' }, user));
            expect(kratos.verifyPassword).not.toHaveBeenCalled();
            expect(prisma.tenant.update).not.toHaveBeenCalled();
        });

        it('rejects when the user row does not exist in this tenant', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

            await expectUnauthorized(service.lock({ reason: 'r', password: 'p' }, user));
            expect(prisma.tenant.update).not.toHaveBeenCalled();
        });
    });

    describe('unlock', () => {
        it('requires the same confirmation before unlocking', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ kratosIdentityId: KRATOS_ID });
            kratos.verifyPassword.mockResolvedValue(false);

            await expectUnauthorized(service.unlock({ password: 'wrong' }, user));
            expect(kratos.verifyPassword).toHaveBeenCalledWith(KRATOS_ID, 'wrong');
        });
    });
});
