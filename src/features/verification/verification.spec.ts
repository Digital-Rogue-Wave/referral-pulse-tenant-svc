import { createHmac } from 'crypto';

import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import type { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import type { BaseException } from '@common/exceptions/base.exceptions';
import type { HttpClientService } from '@common/http/http-client.service';
import { JsonService } from '@common/helper/json.service';
import type { AppLoggerService } from '@common/logging/app-logger.service';
import type { MetricsService } from '@common/monitoring/metrics.service';
import type { DatabaseService } from '@app/database/database.service';

import { AccountVerificationActivities } from './account-verification.activities';
import type { AccountVerificationGateway } from './account-verification.gateway';
import { AdminVerificationService } from './admin-verification.service';
import { CompanyVerificationService, ProviderVerificationResult } from './company-verification.service';
import { FakeKybProvider } from './fake-kyb.provider';
import { KybResultHandler } from './kyb-result.handler';
import { SumsubKybProvider } from './sumsub-kyb.provider';
import { TenantVerificationStatus } from './tenant-verification-status';

const TENANT = '01TENANT00000000000000000T';
const VERIFICATION = '01VERIF000000000000000000V';

type Emitted = { name: string; event: Record<string, unknown> };

/** A Prisma double whose transaction runs the callback on the same delegates, plus the events it emitted. */
function world(tenantStatus = 'unverified') {
    const emitted: Emitted[] = [];
    const tenant = {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Acme', verificationStatus: tenantStatus }),
        findUnique: jest.fn().mockResolvedValue({ id: TENANT }),
        update: jest.fn().mockResolvedValue({})
    };
    const tenantVerification = {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({})
    };
    const auditLog = { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) };
    const prisma = {
        tenant,
        tenantVerification,
        auditLog,
        $transaction: (fn: (tx: unknown) => unknown) => fn({ tenant, tenantVerification, auditLog })
    };
    const events = { emitAfterCommit: (name: string, event: Record<string, unknown>) => emitted.push({ name, event }) };
    const statusWriter = new TenantVerificationStatus(events as unknown as TransactionEventEmitterService);
    const workflows = mock<AccountVerificationGateway>();
    workflows.start.mockResolvedValue({ workflowId: `account-verification-${VERIFICATION}`, runId: 'run-1' });
    const counter = { add: jest.fn() };
    const metrics = { createCounter: jest.fn().mockReturnValue(counter) } as unknown as MetricsService;
    return { prisma, tenant, tenantVerification, auditLog, emitted, statusWriter, workflows, events, metrics, counter };
}

const result = (overrides: Partial<ProviderVerificationResult> = {}): ProviderVerificationResult => ({
    tenantId: TENANT,
    verificationId: VERIFICATION,
    provider: 'sumsub',
    outcome: 'verified',
    reason: null,
    retryAllowed: false,
    providerReference: 'app-1',
    labels: [],
    ...overrides
});

describe('Company verification (v5.2 API §3.17, US1.6.4, US1.6.1)', () => {
    let w: ReturnType<typeof world>;
    let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
    let service: CompanyVerificationService;

    const build = (tenantStatus = 'unverified') => {
        w = world(tenantStatus);
        redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) };
        service = new CompanyVerificationService(
            w.prisma as unknown as DatabaseService,
            w.statusWriter,
            w.workflows,
            w.events as unknown as TransactionEventEmitterService,
            { getClient: () => redis } as never,
            w.metrics,
            { getOrThrow: () => ({ linkTtlSeconds: 1800 }) } as unknown as ConfigService<never>,
            new FakeKybProvider(),
            mock<AppLoggerService>()
        );
    };

    describe('given an unverified company whose Owner opens a session', () => {
        it('then the provider link comes back and nothing changes until the provider calls back', async () => {
            build();

            const session = await service.open(TENANT, 'user-1');

            expect(session).toMatchObject({ status: 'unverified', provider: 'fake' });
            expect(session.providerUrl).toContain(encodeURIComponent(`${TENANT}:${session.verificationId}`));
            expect(w.tenant.update).not.toHaveBeenCalled();
            expect(w.tenantVerification.create).not.toHaveBeenCalled();
            expect(w.emitted.map((e) => e.name)).toEqual(['tenant.verification_requested']);
            expect(redis.set).toHaveBeenCalledWith(`tenant:kyb-session:${TENANT}`, session.verificationId, 'EX', 1800);
        });

        it('then a second click reuses the same applicant while the link lives', async () => {
            build();
            redis.get.mockResolvedValue(VERIFICATION);

            await expect(service.open(TENANT, 'user-1')).resolves.toMatchObject({ verificationId: VERIFICATION });
            expect(redis.set).not.toHaveBeenCalled();
        });
    });

    it.each(['verified', 'pending_review'])('refuses a session for a company that is %s (409)', async (status) => {
        build(status);

        await expect(service.open(TENANT, 'user-1')).rejects.toMatchObject({ status: HttpStatus.CONFLICT } as Partial<BaseException>);
    });

    it('lets a rejected company resubmit; its status stays rejected until the provider calls back', async () => {
        build('rejected');

        await expect(service.open(TENANT, 'user-1')).resolves.toMatchObject({ status: 'rejected' });
        expect(w.tenant.update).not.toHaveBeenCalled();
    });

    describe("given the provider's first callback", () => {
        it('then the case opens in pending_review with evidence references, tenant.verified is emitted and the workflow starts', async () => {
            build();

            await service.applyProviderResult(result());

            expect(w.tenantVerification.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    id: VERIFICATION,
                    status: 'pending_review',
                    evidence: { provider: 'sumsub', result: expect.objectContaining({ outcome: 'verified', reference: 'app-1' }) }
                })
            });
            expect(w.tenant.update).toHaveBeenCalledWith({ where: { id: TENANT }, data: { verificationStatus: 'pending_review' } });
            expect(w.emitted[0]).toMatchObject({
                name: 'tenant.verified',
                event: { previousStatus: 'unverified', verificationStatus: 'pending_review', decidedBy: 'provider:sumsub' }
            });
            expect(w.workflows.start).toHaveBeenCalledWith({ tenantId: TENANT, verificationId: VERIFICATION });
            expect(w.tenantVerification.update).toHaveBeenCalledWith({
                where: { id: VERIFICATION },
                data: { temporalWorkflowId: `account-verification-${VERIFICATION}`, temporalRunId: 'run-1' }
            });
            expect(redis.del).toHaveBeenCalledWith(`tenant:kyb-session:${TENANT}`);
        });

        it('then a provider rejection still goes to a Super Admin: the provider never decides', async () => {
            build();

            await service.applyProviderResult(result({ outcome: 'rejected', reason: 'documents unreadable' }));

            expect(w.tenant.update).toHaveBeenCalledWith({ where: { id: TENANT }, data: { verificationStatus: 'pending_review' } });
        });

        it('then Temporal being down leaves the case under review and counts the failure', async () => {
            build();
            w.workflows.start.mockRejectedValue(new Error('connect ECONNREFUSED'));

            await expect(service.applyProviderResult(result())).resolves.toBeUndefined();
            expect(w.tenant.update).toHaveBeenCalled();
            expect(w.counter.add).toHaveBeenCalledWith(1);
        });
    });

    describe('given a later callback', () => {
        it('then a case still under review gets fresh evidence, no second event and no second workflow', async () => {
            build('pending_review');
            w.tenantVerification.findFirst.mockResolvedValue({ id: VERIFICATION, status: 'pending_review', evidence: {}, temporalWorkflowId: 'wf' });

            await service.applyProviderResult(result({ outcome: 'in_review' }));

            expect(w.tenantVerification.update).toHaveBeenCalledWith({
                where: { id: VERIFICATION },
                data: { evidence: expect.objectContaining({ result: expect.objectContaining({ outcome: 'in_review' }) }) }
            });
            expect(w.emitted).toHaveLength(0);
            expect(w.workflows.start).not.toHaveBeenCalled();
        });

        it('then a case a Super Admin decided is final', async () => {
            build('verified');
            w.tenantVerification.findFirst.mockResolvedValue({ id: VERIFICATION, status: 'verified' });

            await service.applyProviderResult(result({ outcome: 'rejected' }));

            expect(w.tenantVerification.update).not.toHaveBeenCalled();
            expect(w.emitted).toHaveLength(0);
        });
    });
});

describe('Super Admin review (US1.6.2)', () => {
    let w: ReturnType<typeof world>;
    let service: AdminVerificationService;
    const row = (overrides: Record<string, unknown> = {}) => ({
        id: VERIFICATION,
        tenantId: TENANT,
        status: 'pending_review',
        reason: null,
        createdAt: new Date('2026-11-20T09:00:00Z'),
        reviewedAt: null,
        reviewedBy: null,
        evidence: { provider: 'sumsub' },
        temporalWorkflowId: `account-verification-${VERIFICATION}`,
        tenant: { name: 'Acme' },
        ...overrides
    });

    beforeEach(() => {
        w = world('pending_review');
        service = new AdminVerificationService(w.prisma as unknown as DatabaseService, w.statusWriter, w.workflows, mock<AppLoggerService>());
    });

    it('lists the cases under review by default', async () => {
        await service.list();

        expect(w.tenantVerification.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { verificationType: 'company', status: 'pending_review' } })
        );
    });

    it("writes an audit row on the tenant for every read of a case's evidence", async () => {
        w.tenantVerification.findFirst.mockResolvedValue(row());

        await service.detail(VERIFICATION, 'staff:ops-1');

        expect(w.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT,
                actorUserId: 'staff:ops-1',
                action: 'tenant_verification.evidence_read',
                targetId: VERIFICATION
            })
        });
    });

    it('verifies with a reason: the case, the tenant and tenant.verified name the staff member, then the workflow is signalled', async () => {
        w.tenantVerification.findFirst.mockResolvedValue(row());

        await service.approve(VERIFICATION, 'staff:ops-1', 'Registry extract matches');

        expect(w.tenantVerification.update).toHaveBeenCalledWith({
            where: { id: VERIFICATION },
            data: expect.objectContaining({ status: 'verified', reason: 'Registry extract matches', reviewedBy: 'staff:ops-1' })
        });
        expect(w.tenant.update).toHaveBeenCalledWith({ where: { id: TENANT }, data: { verificationStatus: 'verified' } });
        expect(w.emitted[0]).toMatchObject({
            name: 'tenant.verified',
            event: { verificationStatus: 'verified', decidedBy: 'staff:ops-1', userId: 'staff:ops-1', reason: 'Registry extract matches' }
        });
        expect(w.workflows.signalDecided).toHaveBeenCalledWith(`account-verification-${VERIFICATION}`, 'verified');
    });

    it('rejects with a reason the Owner will see', async () => {
        w.tenantVerification.findFirst.mockResolvedValue(row());

        await service.reject(VERIFICATION, 'staff:ops-1', 'Company not found in the registry');

        expect(w.emitted[0]).toMatchObject({ event: { verificationStatus: 'rejected', reason: 'Company not found in the registry' } });
    });

    it('keeps the decision when Temporal cannot be signalled', async () => {
        w.tenantVerification.findFirst.mockResolvedValue(row());
        w.workflows.signalDecided.mockRejectedValue(new Error('unavailable'));

        await expect(service.approve(VERIFICATION, 'staff:ops-1', 'ok')).resolves.toMatchObject({ id: VERIFICATION });
        expect(w.tenant.update).toHaveBeenCalled();
    });

    it('refuses to decide a case already decided (409)', async () => {
        w.tenantVerification.findFirst.mockResolvedValue(row({ status: 'rejected' }));

        await expect(service.approve(VERIFICATION, 'staff:ops-1', 'ok')).rejects.toMatchObject({
            status: HttpStatus.CONFLICT
        } as Partial<BaseException>);
        expect(w.emitted).toHaveLength(0);
    });

    it('answers 404 for an unknown verification, and audits nothing', async () => {
        await expect(service.detail('nope', 'staff:ops-1')).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND } as Partial<BaseException>);
        expect(w.auditLog.create).not.toHaveBeenCalled();
    });
});

describe('The 7-day review SLA (US1.6.1 AC3)', () => {
    const build = (status: string | null, alreadyReported = false) => {
        const w = world();
        w.tenantVerification.findFirst.mockResolvedValue(status ? { status } : null);
        w.auditLog.findFirst.mockResolvedValue(alreadyReported ? { id: 'a1' } : null);
        const logger = mock<AppLoggerService>();
        return { w, logger, activities: new AccountVerificationActivities(w.prisma as unknown as DatabaseService, w.metrics, logger) };
    };

    it('raises the alert for a case still under review: error log, metric and one audit row', async () => {
        const { w, logger, activities } = build('pending_review');

        await activities.reportSlaBreach({ tenantId: TENANT, verificationId: VERIFICATION });

        expect(w.metrics.createCounter).toHaveBeenCalledWith('kyb_review_sla_breached_total');
        expect(logger.error).toHaveBeenCalled();
        expect(w.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'tenant_verification.sla_breached', actorUserId: 'system' })
        });
    });

    it.each([
        ['verified', false],
        ['pending_review', true]
    ])('stays silent for a %s case (already reported: %s)', async (status, reported) => {
        const { w, activities } = build(status, reported);

        await activities.reportSlaBreach({ tenantId: TENANT, verificationId: VERIFICATION });

        expect(w.auditLog.create).not.toHaveBeenCalled();
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
