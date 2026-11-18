import { createHmac } from 'crypto';

import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import type { BullJobsService } from '@common/bulljobs';
import type { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import type { BaseException } from '@common/exceptions/base.exceptions';
import type { HttpClientService } from '@common/http/http-client.service';
import { JsonService } from '@common/helper/json.service';
import type { AppLoggerService } from '@common/logging/app-logger.service';
import type { DatabaseService } from '@app/database/database.service';
import type { TenantService } from '@app/features/tenant/tenant.service';

import { AdminVerificationService } from './admin-verification.service';
import { CompanyVerificationService, VERIFICATION_ESCALATION_QUEUE } from './company-verification.service';
import { FakeKybProvider } from './fake-kyb.provider';
import { KybResultHandler } from './kyb-result.handler';
import { SumsubKybProvider } from './sumsub-kyb.provider';

const TENANT = '01TENANT00000000000000000T';

/** Product Spec R-INT-02 (E1 D15): company verification through a KYB provider. */
describe('Company verification', () => {
    let prisma: {
        tenant: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
        tenantVerification: { findFirst: jest.Mock; create: jest.Mock };
        auditLog: { create: jest.Mock };
        $transaction: jest.Mock;
    };
    let tenants: MockProxy<TenantService>;
    let events: MockProxy<TransactionEventEmitterService>;
    let bullJobs: MockProxy<BullJobsService>;
    let service: CompanyVerificationService;

    beforeEach(() => {
        prisma = {
            tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Acme', verificationStatus: 'unverified' }), update: jest.fn() },
            tenantVerification: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
            auditLog: { create: jest.fn() },
            $transaction: jest.fn()
        };
        prisma.$transaction.mockImplementation((run: (tx: unknown) => unknown) => run(prisma));
        tenants = mock<TenantService>();
        events = mock<TransactionEventEmitterService>();
        bullJobs = mock<BullJobsService>();
        service = new CompanyVerificationService(
            prisma as unknown as DatabaseService,
            tenants,
            events,
            bullJobs,
            new FakeKybProvider(),
            mock<AppLoggerService>()
        );
    });

    describe('given an unverified company whose Owner opens a session', () => {
        it('then a verification starts, the tenant becomes pending and the provider link is returned', async () => {
            const session = await service.open(TENANT, 'user-1');

            expect(session).toMatchObject({ status: 'pending', provider: 'fake' });
            expect(session.providerUrl).toContain(encodeURIComponent(`${TENANT}:${session.verificationId}`));
            expect(prisma.tenantVerification.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ id: session.verificationId, tenantId: TENANT, verificationType: 'company' })
            });
            expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: TENANT }, data: { verificationStatus: 'pending' } });
            expect(events.emitAfterCommit).toHaveBeenCalledWith(
                'tenant.verification_requested',
                expect.objectContaining({ verificationId: session.verificationId })
            );
            expect(events.emitAfterCommit).toHaveBeenCalledWith(
                'tenant.verification_status_changed',
                expect.objectContaining({ previousStatus: 'unverified', newStatus: 'pending' })
            );
        });

        it('then a Super Admin escalation is scheduled seven days out', async () => {
            const session = await service.open(TENANT, 'user-1');

            expect(bullJobs.addDelayedJob).toHaveBeenCalledWith(
                VERIFICATION_ESCALATION_QUEUE,
                'escalate',
                { tenantId: TENANT, verificationId: session.verificationId },
                7 * 86_400_000,
                { jobId: `verification-escalation-${session.verificationId}` }
            );
        });
    });

    describe('given a verification already open', () => {
        it('then the Owner gets a fresh link to the same case and nothing new starts', async () => {
            prisma.tenant.findUniqueOrThrow.mockResolvedValue({ name: 'Acme', verificationStatus: 'pending' });
            prisma.tenantVerification.findFirst.mockResolvedValue({ id: 'v-open', status: 'pending' });

            const session = await service.open(TENANT, 'user-1');

            expect(session.verificationId).toBe('v-open');
            expect(prisma.tenantVerification.create).not.toHaveBeenCalled();
            expect(bullJobs.addDelayedJob).not.toHaveBeenCalled();
        });
    });

    describe('given a rejected company', () => {
        it('then it may resubmit: a new verification starts and the tenant is pending again', async () => {
            prisma.tenant.findUniqueOrThrow.mockResolvedValue({ name: 'Acme', verificationStatus: 'rejected' });

            await service.open(TENANT, 'user-1');

            expect(prisma.tenantVerification.create).toHaveBeenCalled();
            expect(events.emitAfterCommit).toHaveBeenCalledWith(
                'tenant.verification_status_changed',
                expect.objectContaining({ previousStatus: 'rejected', newStatus: 'pending' })
            );
        });
    });

    it('refuses a session for a company already verified (409)', async () => {
        prisma.tenant.findUniqueOrThrow.mockResolvedValue({ name: 'Acme', verificationStatus: 'verified' });

        const error = await service.open(TENANT, 'user-1').catch((e: BaseException) => e);

        expect((error as BaseException).getStatus()).toBe(HttpStatus.CONFLICT);
    });

    describe("given the provider's result", () => {
        const result = {
            tenantId: TENANT,
            verificationId: 'v1',
            provider: 'sumsub',
            outcome: 'rejected' as const,
            reason: 'bad document',
            retryAllowed: true,
            providerReference: 'app-1',
            labels: ['BAD_PROOF']
        };

        it('then it is applied to that exact verification, with the provider as reviewer and its result kept', async () => {
            prisma.tenantVerification.findFirst.mockResolvedValue({ id: 'v1', status: 'pending', evidence: { provider: 'sumsub' } });

            await service.applyProviderResult(result);

            expect(tenants.applyVerificationReport).toHaveBeenCalledWith(TENANT, {
                verificationId: 'v1',
                verificationType: 'company',
                status: 'rejected',
                reason: 'bad document',
                reviewedBy: 'provider:sumsub',
                evidence: { provider: 'sumsub', result: { outcome: 'rejected', reference: 'app-1', labels: ['BAD_PROOF'], retry_allowed: true } }
            });
        });

        it('then a result for a verification already decided is ignored: the decision stands', async () => {
            prisma.tenantVerification.findFirst.mockResolvedValue({ id: 'v1', status: 'verified', evidence: null });

            await service.applyProviderResult(result);

            expect(tenants.applyVerificationReport).not.toHaveBeenCalled();
        });

        it('then a result for an unknown verification is ignored', async () => {
            await service.applyProviderResult(result);

            expect(tenants.applyVerificationReport).not.toHaveBeenCalled();
        });
    });

    describe('given seven days have passed', () => {
        it('then a still-pending verification goes to in_review and the escalation is audited', async () => {
            prisma.tenantVerification.findFirst.mockResolvedValue({ id: 'v1', status: 'pending' });

            await service.escalate({ tenantId: TENANT, verificationId: 'v1' });

            expect(tenants.applyVerificationReport).toHaveBeenCalledWith(
                TENANT,
                expect.objectContaining({ verificationId: 'v1', status: 'in_review' })
            );
            expect(prisma.auditLog.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ action: 'tenant_verification.escalated', targetId: 'v1' })
            });
        });

        it('then a decided verification is left alone', async () => {
            prisma.tenantVerification.findFirst.mockResolvedValue({ id: 'v1', status: 'verified' });

            await service.escalate({ tenantId: TENANT, verificationId: 'v1' });

            expect(prisma.auditLog.create).not.toHaveBeenCalled();
        });
    });
});

describe('Super Admin review of company verifications (US1.6.2, E1 D15)', () => {
    const row = {
        id: 'v1',
        tenantId: TENANT,
        status: 'in_review',
        reason: null,
        createdAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        evidence: { provider: 'sumsub' },
        tenant: { name: 'Acme' }
    };
    let findFirst: jest.Mock;
    let findMany: jest.Mock;
    let audit: jest.Mock;
    let tenants: MockProxy<TenantService>;
    let service: AdminVerificationService;

    beforeEach(() => {
        findFirst = jest.fn().mockResolvedValue(row);
        findMany = jest.fn().mockResolvedValue([row]);
        audit = jest.fn();
        tenants = mock<TenantService>();
        service = new AdminVerificationService(
            { tenantVerification: { findFirst, findMany }, auditLog: { create: audit } } as unknown as DatabaseService,
            tenants
        );
    });

    it("lists what the provider couldn't settle by default", async () => {
        await expect(service.list()).resolves.toEqual([expect.objectContaining({ id: 'v1', tenantName: 'Acme', status: 'in_review' })]);
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { verificationType: 'company', status: 'in_review' } }));
    });

    it("writes an audit row on the tenant for every read of a verification's evidence", async () => {
        const detail = await service.detail('v1', 'staff:id-1');

        expect(detail.evidence).toEqual({ provider: 'sumsub' });
        expect(audit).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT,
                actorUserId: 'staff:id-1',
                action: 'tenant_verification.evidence_read',
                targetId: 'v1'
            })
        });
    });

    it('approves and rejects through the one report path, with the staff member as reviewer', async () => {
        await service.approve('v1', 'staff:id-1');
        await service.reject('v1', 'staff:id-1', 'registry extract expired');

        expect(tenants.applyVerificationReport).toHaveBeenNthCalledWith(
            1,
            TENANT,
            expect.objectContaining({ verificationId: 'v1', status: 'verified', reviewedBy: 'staff:id-1' })
        );
        expect(tenants.applyVerificationReport).toHaveBeenNthCalledWith(
            2,
            TENANT,
            expect.objectContaining({ verificationId: 'v1', status: 'rejected', reason: 'registry extract expired', reviewedBy: 'staff:id-1' })
        );
    });

    it('answers 404 for an unknown verification, and audits nothing', async () => {
        findFirst.mockResolvedValue(null);

        const error = await service.detail('nope', 'staff:id-1').catch((e: BaseException) => e);

        expect((error as BaseException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect(audit).not.toHaveBeenCalled();
    });
});

describe("Reading the KYB provider's result off the bus", () => {
    let verifications: MockProxy<CompanyVerificationService>;
    let handler: KybResultHandler;
    const message = (body: unknown) => ({ Body: JSON.stringify(body) });

    beforeEach(() => {
        verifications = mock<CompanyVerificationService>();
        handler = new KybResultHandler(verifications, new JsonService(), mock<AppLoggerService>());
    });

    it('applies provider.verification_reviewed and claims the message', async () => {
        const handled = await handler.handle(
            message({
                eventType: 'provider.verification_reviewed',
                payload: { tenant_id: TENANT, verification_id: 'v1', provider: 'sumsub', outcome: 'verified', provider_reference: 'app-1' }
            })
        );

        expect(handled).toBe(true);
        expect(verifications.applyProviderResult).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: TENANT, verificationId: 'v1', outcome: 'verified' })
        );
    });

    it('leaves every other message to the consent registry', async () => {
        await expect(handler.handle(message({ eventType: 'touch.recorded', payload: {} }))).resolves.toBe(false);
        expect(verifications.applyProviderResult).not.toHaveBeenCalled();
    });

    it('drops a result with an unknown outcome without failing the message', async () => {
        await expect(
            handler.handle(
                message({ eventType: 'provider.verification_reviewed', payload: { tenant_id: TENANT, verification_id: 'v1', outcome: 'maybe' } })
            )
        ).resolves.toBe(true);
        expect(verifications.applyProviderResult).not.toHaveBeenCalled();
    });
});

describe('Opening a Sumsub session', () => {
    it('signs the WebSDK link request the way Sumsub documents it, with our applicant id', async () => {
        const post = jest.fn().mockResolvedValue({ data: { url: 'https://in.sumsub.com/websdk/p/abc' } });
        const provider = new SumsubKybProvider(
            { post } as unknown as HttpClientService,
            {
                getOrThrow: () => ({
                    provider: 'sumsub',
                    sumsubBaseUrl: 'https://api.sumsub.com',
                    sumsubAppToken: 'app-token',
                    sumsubSecretKey: 'secret',
                    sumsubLevelName: 'kyb-company',
                    linkTtlSeconds: 1800
                })
            } as unknown as ConfigService<never>
        );

        const session = await provider.openSession(TENANT, 'v1');

        expect(session).toEqual({ provider: 'sumsub', externalUserId: `${TENANT}:v1`, url: 'https://in.sumsub.com/websdk/p/abc' });
        const [url, body, options] = post.mock.calls[0] as [string, string, { headers: Record<string, string> }];
        expect(url).toBe('https://api.sumsub.com/resources/sdkIntegrations/levels/-/websdkLink');
        expect(JSON.parse(body)).toEqual({ levelName: 'kyb-company', userId: `${TENANT}:v1`, ttlInSecs: 1800 });
        const ts = options.headers['X-App-Access-Ts'];
        const expected = createHmac('sha256', 'secret').update(`${ts}POST/resources/sdkIntegrations/levels/-/websdkLink${body}`).digest('hex');
        expect(options.headers).toMatchObject({ 'X-App-Token': 'app-token', 'X-App-Access-Sig': expected });
    });

    it('fails loudly without credentials rather than pretending', async () => {
        const provider = new SumsubKybProvider(mock<HttpClientService>(), {
            getOrThrow: () => ({ provider: 'sumsub' })
        } as unknown as ConfigService<never>);

        await expect(provider.openSession(TENANT, 'v1')).rejects.toThrow('SUMSUB_APP_TOKEN');
    });
});
