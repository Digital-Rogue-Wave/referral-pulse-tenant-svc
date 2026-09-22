import { Test } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';

import { TenantService } from './tenant.service';
import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DateService } from '@common/helper/date.service';
import { KratosService } from '@common/auth/kratos.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { VerificationRecordStatus, VerificationType } from '@domains/tenant';
import { SubdomainService } from '../dns/subdomain.service';
import { DnsVerificationService } from '../dns/dns-verification.service';
import { FilesService } from '../files/files.service';
import { UsersService } from '../users/users.service';

const TENANT = {
    id: 't1',
    name: 'Acme',
    slug: 'acme',
    status: 'active',
    verificationStatus: 'pending',
    createdAt: new Date(),
    updatedAt: new Date()
};

/** The account_verification workflow reports into `tenant_verifications` (DB Model v2 §3). */
describe('TenantService.applyVerificationReport', () => {
    let service: TenantService;
    let prisma: MockProxy<DatabaseService>;
    let events: MockProxy<TransactionEventEmitterService>;
    let tx: { tenantVerification: Record<string, jest.Mock>; tenant: Record<string, jest.Mock> };

    beforeEach(async () => {
        prisma = mock<DatabaseService>();
        events = mock<TransactionEventEmitterService>();
        tx = {
            tenantVerification: {
                findFirst: jest.fn().mockResolvedValue({ id: 'verif-1', status: 'pending' }),
                update: jest.fn(),
                create: jest.fn()
            },
            tenant: { update: jest.fn(async ({ data }: { data: object }) => ({ ...TENANT, ...data })) }
        };
        Object.assign(prisma, {
            tenant: { findUnique: jest.fn().mockResolvedValue(TENANT) },
            $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) => fn(tx))
        });

        const module = await Test.createTestingModule({
            providers: [
                TenantService,
                { provide: DatabaseService, useValue: prisma },
                { provide: TenantContextService, useValue: mock<TenantContextService>() },
                { provide: TransactionEventEmitterService, useValue: events },
                { provide: AppLoggerService, useValue: mock<AppLoggerService>() },
                { provide: DateService, useValue: mock<DateService>() },
                { provide: SubdomainService, useValue: mock<SubdomainService>() },
                { provide: DnsVerificationService, useValue: mock<DnsVerificationService>() },
                { provide: FilesService, useValue: mock<FilesService>() },
                { provide: KratosService, useValue: mock<KratosService>() },
                { provide: UsersService, useValue: mock<UsersService>() }
            ]
        }).compile();
        service = module.get(TenantService);
    });

    it('closes the open company verification with its review and verifies the tenant', async () => {
        const result = await service.applyVerificationReport('t1', {
            status: VerificationRecordStatus.VERIFIED,
            reviewedBy: 'system',
            temporalWorkflowId: 'account_verification-t1',
            temporalRunId: 'run-1'
        });

        expect(tx.tenantVerification.update).toHaveBeenCalledWith({
            where: { id: 'verif-1' },
            data: expect.objectContaining({
                status: 'verified',
                reviewedBy: 'system',
                reviewedAt: expect.any(Date),
                temporalWorkflowId: 'account_verification-t1',
                temporalRunId: 'run-1'
            })
        });
        expect(tx.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { verificationStatus: 'verified' } });
        expect(events.emitAfterCommit).toHaveBeenCalledWith(
            'tenant.verification_status_changed',
            expect.objectContaining({ previousStatus: 'pending', newStatus: 'verified' })
        );
        expect(result.verificationStatus).toBe('verified');
    });

    it('records progress (in review) without changing the tenant, which is still pending', async () => {
        await service.applyVerificationReport('t1', { status: VerificationRecordStatus.IN_REVIEW });

        expect(tx.tenantVerification.update).toHaveBeenCalledWith({
            where: { id: 'verif-1' },
            data: expect.objectContaining({ status: 'in_review', reviewedAt: null })
        });
        expect(tx.tenant.update).not.toHaveBeenCalled();
        expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('opens a new verification when none is open, e.g. a re-verification decided by the workflow', async () => {
        tx.tenantVerification.findFirst!.mockResolvedValue(null);

        await service.applyVerificationReport('t1', { status: VerificationRecordStatus.REJECTED, reason: 'registry mismatch' });

        expect(tx.tenantVerification.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ tenantId: 't1', verificationType: 'company', status: 'rejected', reason: 'registry mismatch' })
        });
        expect(tx.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { verificationStatus: 'rejected' } });
    });

    it('records a tax or payout verification without touching the tenant status', async () => {
        await service.applyVerificationReport('t1', { status: VerificationRecordStatus.VERIFIED, verificationType: VerificationType.TAX });

        expect(tx.tenantVerification.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ verificationType: 'tax' }) })
        );
        expect(tx.tenant.update).not.toHaveBeenCalled();
    });

    it('refuses a verification id that does not belong to the tenant', async () => {
        tx.tenantVerification.findFirst!.mockResolvedValue(null);

        const error = await service
            .applyVerificationReport('t1', { status: VerificationRecordStatus.VERIFIED, verificationId: '01J00000000000000000000000' })
            .catch((e: BaseException) => e);

        expect((error as BaseException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect(tx.tenant.update).not.toHaveBeenCalled();
    });
});
