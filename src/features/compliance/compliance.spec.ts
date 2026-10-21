import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AxiosError } from 'axios';
import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { DSR_FANOUT_JOB, DSR_FANOUT_QUEUE } from '@app/types';
import { BullJobsService } from '@common/bulljobs';
import { ServiceTokenProvider } from '@common/clients/service-token.provider';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { hashEmail } from '@common/helper/hashing';
import { JsonService } from '@common/helper/json.service';
import { HttpClientService } from '@common/http/http-client.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantAwareService } from '@common/tenant-aware/tenant-aware.service';
import { ComplianceEvents, DsrReceiptStatus, DsrRequestType, DsrStatus, DSR_DEADLINE_DAYS } from '@domains/compliance';
import { OperatorErasureService } from '@app/features/users/operator-erasure.service';

import { ConsentConsumer } from './consent.consumer';
import { ConsentService } from './consent.service';
import { DsrFanOutService } from './dsr-fanout.service';
import { DsrService } from './dsr.service';
import { ERASURE_TARGETS, REMOTE_ERASURE_PATH } from './dsr-targets';
import { ErasureClient } from './erasure.client';

const TENANT = 't1';
const EMAIL = 'ada@acme.io';
const HASH = hashEmail(EMAIL);
const NOW = new Date('2026-10-21T10:00:00Z');

const logger = () => mock<AppLoggerService>();

describe('DsrService — POST /v1/dsr and GET /v1/dsr/{id}', () => {
    let prisma: MockProxy<DatabaseService>;
    let txEvents: MockProxy<TransactionEventEmitterService>;
    let bullJobs: MockProxy<BullJobsService>;
    let tenantAware: MockProxy<TenantAwareService>;
    let create: jest.Mock;
    let service: DsrService;

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(NOW);
        create = jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'dsr1', createdAt: NOW, ...data }));
        prisma = mock<DatabaseService>();
        Object.assign(prisma, {
            dsrRequest: { findFirst: jest.fn() },
            $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({ dsrRequest: { create } }))
        });
        txEvents = mock<TransactionEventEmitterService>();
        bullJobs = mock<BullJobsService>();
        tenantAware = mock<TenantAwareService>();
        tenantAware.getRequiredTenantId.mockReturnValue(TENANT);
        tenantAware.withTenantFilter.mockImplementation((where) => ({ ...where, tenantId: TENANT }) as never);
        service = new DsrService(prisma, tenantAware, txEvents, bullJobs, logger());
    });

    afterEach(() => jest.useRealTimers());

    it('hashes the subject’s address and never stores it in the clear', async () => {
        await service.create({ requestType: DsrRequestType.ERASURE, subjectEmail: EMAIL }, 'u1');

        const { data } = create.mock.calls[0]![0] as { data: Record<string, unknown> };
        expect(data.subjectEmailHash).toBe(HASH);
        expect(JSON.stringify(data)).not.toContain(EMAIL);
    });

    it('stamps the legal deadline at submission, so an overdue request is a query', async () => {
        const response = await service.create({ requestType: DsrRequestType.ERASURE, subjectEmail: EMAIL }, 'u1');

        expect(response.dueAt).toEqual(new Date(NOW.getTime() + DSR_DEADLINE_DAYS * 86_400_000));
    });

    it('queues the fan-out for an erasure and publishes dsr.requested', async () => {
        const response = await service.create({ requestType: DsrRequestType.ERASURE, subjectEmail: EMAIL }, 'u1');

        expect(response.status).toBe(DsrStatus.PENDING);
        expect(bullJobs.addJob).toHaveBeenCalledWith(DSR_FANOUT_QUEUE, DSR_FANOUT_JOB, { tenantId: TENANT, dsrId: 'dsr1', userId: 'u1' });
        expect(txEvents.emitAfterCommit).toHaveBeenCalledWith(ComplianceEvents.DSR_REQUESTED, expect.objectContaining({ tenantId: TENANT }));
    });

    /**
     * No v5 document specifies what the other six services return for an access or portability
     * request, so the request is recorded, dated and answerable, and nothing is fanned out.
     */
    it('accepts an access request without fanning anything out', async () => {
        const response = await service.create({ requestType: DsrRequestType.ACCESS, subjectEmail: EMAIL }, 'u1');

        expect(response.status).toBe(DsrStatus.ACCEPTED);
        expect(bullJobs.addJob).not.toHaveBeenCalled();
        expect(txEvents.emitAfterCommit).toHaveBeenCalledWith(ComplianceEvents.DSR_REQUESTED, expect.anything());
    });

    it('reads one request with its receipts, scoped to the caller’s tenant', async () => {
        (prisma.dsrRequest.findFirst as jest.Mock).mockResolvedValue({
            id: 'dsr1',
            tenantId: TENANT,
            requestType: 'erasure',
            status: 'in_progress',
            subjectEmailHash: HASH,
            subjectExternalId: null,
            subjectId: null,
            requestedBy: 'u1',
            dueAt: NOW,
            completedAt: null,
            createdAt: NOW,
            receipts: [{ serviceName: 'reward-service', status: 'completed', receipt: {}, retainedUnderObligation: true, receivedAt: NOW }]
        });

        const response = await service.findOne('dsr1');

        expect((prisma.dsrRequest.findFirst as jest.Mock).mock.calls[0]![0].where).toEqual({ id: 'dsr1', tenantId: TENANT });
        expect(response.receipts).toEqual([
            { serviceName: 'reward-service', status: 'completed', receipt: {}, retainedUnderObligation: true, receivedAt: NOW }
        ]);
    });

    it('is 404 for a request another tenant owns, or none at all', async () => {
        (prisma.dsrRequest.findFirst as jest.Mock).mockResolvedValue(null);

        const error = await service.findOne('nope').catch((e: BaseException) => e);

        expect((error as BaseException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    });
});

describe('ErasureClient — asking one service to erase its share', () => {
    const target = ERASURE_TARGETS.find((candidate) => candidate.serviceName === 'reward-service')!;
    let http: MockProxy<HttpClientService>;
    let client: ErasureClient;

    beforeEach(() => {
        http = mock<HttpClientService>();
        const tokens = mock<ServiceTokenProvider>();
        tokens.authorization.mockResolvedValue('Bearer svc.jwt');
        const configService = mock<ConfigService>();
        configService.getOrThrow.mockReturnValue({ rewards: { url: 'http://rewards.local' } });
        client = new ErasureClient(http, tokens, configService as never, logger());
    });

    it('calls the target’s erasure handler with this service’s own token', async () => {
        http.post.mockResolvedValue({ data: { status: 'completed', retained: [] }, status: 200, headers: {}, duration: 1 });

        await client.erase(target, { dsrId: 'dsr1', subjectEmailHash: HASH });

        expect(http.post).toHaveBeenCalledWith(
            `http://rewards.local${REMOTE_ERASURE_PATH}`,
            { dsrId: 'dsr1', subjectEmailHash: HASH },
            expect.objectContaining({ headers: { Authorization: 'Bearer svc.jwt' } })
        );
    });

    it('flags a target that kept rows under legal obligation, which is what the subject has to be told', async () => {
        http.post.mockResolvedValue({
            data: { status: 'completed', retained: ['reward_ledger: tax law'] },
            status: 200,
            headers: {},
            duration: 1
        });

        await expect(client.erase(target, { dsrId: 'dsr1' })).resolves.toMatchObject({
            status: DsrReceiptStatus.COMPLETED,
            retainedUnderObligation: true
        });
    });

    /** `blocked` means the target answered and did not erase — a retry will not change that. */
    it('records a blocked answer as failed', async () => {
        http.post.mockResolvedValue({ data: { status: 'blocked' }, status: 200, headers: {}, duration: 1 });

        await expect(client.erase(target, { dsrId: 'dsr1' })).resolves.toMatchObject({ status: DsrReceiptStatus.FAILED });
    });

    it.each([
        ['a handler that does not exist yet', 404],
        ['a service that is failing', 503]
    ])('leaves %s as a pending receipt, so the next sweep asks again', async (_case, status) => {
        http.post.mockRejectedValue(new AxiosError('boom', undefined, undefined, undefined, { status } as never));

        await expect(client.erase(target, { dsrId: 'dsr1' })).resolves.toMatchObject({
            status: DsrReceiptStatus.PENDING,
            receipt: expect.objectContaining({ unanswered: `HTTP ${status}` })
        });
    });

    it('never throws when the target is unreachable', async () => {
        http.post.mockRejectedValue(new Error('ECONNREFUSED'));

        await expect(client.erase(target, { dsrId: 'dsr1' })).resolves.toMatchObject({ status: DsrReceiptStatus.PENDING });
    });

    /** A 403 is this service's grant being wrong, not a transient failure — an operator has to act. */
    it('records a refusal as failed rather than pending', async () => {
        http.post.mockRejectedValue(new AxiosError('nope', undefined, undefined, undefined, { status: 403 } as never));

        await expect(client.erase(target, { dsrId: 'dsr1' })).resolves.toMatchObject({ status: DsrReceiptStatus.FAILED });
    });
});

describe('DsrFanOutService — the erasure fan-out', () => {
    const request = (overrides: Record<string, unknown> = {}) => ({
        id: 'dsr1',
        tenantId: TENANT,
        subjectId: null,
        subjectEmailHash: HASH,
        subjectExternalId: null,
        requestType: 'erasure',
        status: DsrStatus.PENDING,
        requestedBy: 'u1',
        dueAt: NOW,
        completedAt: null,
        createdAt: NOW,
        receipts: [],
        ...overrides
    });
    const answered = (serviceName: string) => ({
        serviceName,
        status: DsrReceiptStatus.COMPLETED,
        receipt: {},
        retainedUnderObligation: false,
        receivedAt: NOW
    });

    let prisma: MockProxy<DatabaseService>;
    let erasure: MockProxy<ErasureClient>;
    let operators: MockProxy<OperatorErasureService>;
    let txEvents: MockProxy<TransactionEventEmitterService>;
    let upsert: jest.Mock;
    let update: jest.Mock;
    let service: DsrFanOutService;

    beforeEach(() => {
        upsert = jest.fn();
        update = jest.fn().mockResolvedValue(request({ receipts: ERASURE_TARGETS.map((t) => answered(t.serviceName)) }));
        prisma = mock<DatabaseService>();
        Object.assign(prisma, {
            dsrRequest: { findFirst: jest.fn().mockResolvedValue(request()), update: jest.fn(), findMany: jest.fn() },
            dsrReceipt: { upsert },
            $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({ dsrRequest: { update } }))
        });
        erasure = mock<ErasureClient>();
        erasure.erase.mockResolvedValue({ status: DsrReceiptStatus.COMPLETED, receipt: {}, retainedUnderObligation: false });
        operators = mock<OperatorErasureService>();
        operators.erase.mockResolvedValue({ status: 'completed', retained: [], erasedUserIds: ['u9'] } as never);
        txEvents = mock<TransactionEventEmitterService>();
        service = new DsrFanOutService(prisma, erasure, operators, txEvents, logger());
    });

    it('asks every target R-CPL-02 names, and writes one receipt each', async () => {
        const outcome = await service.run('dsr1', TENANT);

        expect(outcome.outstanding).toEqual([]);
        expect(upsert).toHaveBeenCalledTimes(ERASURE_TARGETS.length);
        expect(upsert.mock.calls.map(([args]) => args.where.dsrRequestId_serviceName.serviceName)).toEqual(
            ERASURE_TARGETS.map((target) => target.serviceName)
        );
    });

    /** Identity's share is this service's own handler, so the fan-out never calls itself over HTTP. */
    it('runs Identity in-process and the other five over HTTP', async () => {
        await service.run('dsr1', TENANT);

        expect(operators.erase).toHaveBeenCalledWith({ dsrId: 'dsr1', subjectEmailHash: HASH });
        expect(erasure.erase).toHaveBeenCalledTimes(ERASURE_TARGETS.length - 1);
    });

    /**
     * The whole resumption story: a re-run asks only the targets that still owe an answer, so a crash
     * mid-fan-out, a BullMQ retry and the hourly sweep all converge on the same six receipts.
     */
    it('skips the targets that already answered, so a re-run resumes rather than restarts', async () => {
        (prisma.dsrRequest.findFirst as jest.Mock).mockResolvedValue(
            request({ status: DsrStatus.IN_PROGRESS, receipts: [answered('tenant-service'), answered('reward-service')] })
        );

        await service.run('dsr1', TENANT);

        expect(operators.erase).not.toHaveBeenCalled();
        expect(erasure.erase.mock.calls.map(([target]) => target.serviceName)).toEqual([
            'referral-workflow-service',
            'analytics-service',
            'ai-service',
            'notification-service'
        ]);
    });

    it('re-asks a target whose last answer was pending', async () => {
        (prisma.dsrRequest.findFirst as jest.Mock).mockResolvedValue(
            request({ receipts: [{ ...answered('reward-service'), status: DsrReceiptStatus.PENDING }] })
        );

        await service.run('dsr1', TENANT);

        expect(erasure.erase.mock.calls.map(([target]) => target.serviceName)).toContain('reward-service');
    });

    it('publishes erasure.completed with every receipt, then audit.logged', async () => {
        await service.run('dsr1', TENANT);

        expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: DsrStatus.COMPLETED }) }));
        const [completedEvent, auditEvent] = txEvents.emitAfterCommit.mock.calls.map(([, payload]) => payload);
        expect(completedEvent).toMatchObject({
            eventType: ComplianceEvents.ERASURE_COMPLETED,
            payload: { receipts: ERASURE_TARGETS.map((t) => ({ service: t.serviceName, status: 'completed', retained_under_obligation: false })) }
        });
        expect(auditEvent).toMatchObject({
            eventType: ComplianceEvents.AUDIT_LOGGED,
            payload: { action: ComplianceEvents.ERASURE_COMPLETED, receiptCount: ERASURE_TARGETS.length }
        });
    });

    it('does not complete the request while a target still owes an answer', async () => {
        erasure.erase.mockResolvedValue({ status: DsrReceiptStatus.PENDING, receipt: {}, retainedUnderObligation: false });

        const outcome = await service.run('dsr1', TENANT);

        expect(outcome.outstanding).toHaveLength(ERASURE_TARGETS.length - 1);
        expect(update).not.toHaveBeenCalled();
        expect(txEvents.emitAfterCommit).not.toHaveBeenCalled();
    });

    /**
     * `subject_id` and `subject_external_id` name a participant or invitee; an operator record is only
     * ever matched by email hash. Calling the handler without one would match on `undefined`.
     */
    it('never asks Identity to erase a subject it cannot match', async () => {
        (prisma.dsrRequest.findFirst as jest.Mock).mockResolvedValue(request({ subjectEmailHash: null, subjectExternalId: 'cust-9' }));

        await service.run('dsr1', TENANT);

        expect(operators.erase).not.toHaveBeenCalled();
        expect(upsert.mock.calls[0]![0].create).toMatchObject({
            serviceName: 'tenant-service',
            status: DsrReceiptStatus.COMPLETED,
            receipt: expect.objectContaining({ reason: 'subject carries no email hash' })
        });
    });

    it('lists unfinished erasures by deadline for the sweeper', async () => {
        (prisma.dsrRequest.findMany as jest.Mock).mockResolvedValue([{ id: 'dsr1', tenantId: TENANT }]);

        await expect(service.findUnfinished(50)).resolves.toEqual([{ id: 'dsr1', tenantId: TENANT }]);
        expect((prisma.dsrRequest.findMany as jest.Mock).mock.calls[0]![0]).toMatchObject({
            where: { requestType: 'erasure', status: { in: [DsrStatus.PENDING, DsrStatus.IN_PROGRESS] } },
            orderBy: { dueAt: 'asc' },
            take: 50
        });
    });
});

describe('ConsentService — the consent registry', () => {
    const signal = (overrides: Record<string, unknown> = {}) => ({
        tenantId: TENANT,
        subjectEmailHash: HASH,
        subjectExternalId: null,
        trackingConsent: 'granted',
        marketingConsent: null,
        consentSource: 'cmp_banner',
        recordedAt: NOW,
        ...overrides
    });

    let prisma: MockProxy<DatabaseService>;
    let txEvents: MockProxy<TransactionEventEmitterService>;
    let create: jest.Mock;
    let service: ConsentService;

    beforeEach(() => {
        create = jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'cs1', ...data }));
        prisma = mock<DatabaseService>();
        Object.assign(prisma, {
            consent: { findFirst: jest.fn().mockResolvedValue(null) },
            $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({ consent: { create } }))
        });
        txEvents = mock<TransactionEventEmitterService>();
        service = new ConsentService(prisma, txEvents, logger());
    });

    it('records the subject’s first signal and publishes consent.recorded', async () => {
        await expect(service.record(signal())).resolves.toBe('recorded');

        expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ trackingConsent: 'granted', withdrawnAt: null }) });
        expect(txEvents.emitAfterCommit).toHaveBeenCalledWith(ComplianceEvents.CONSENT_RECORDED, expect.objectContaining({ tenantId: TENANT }));
    });

    /** Almost every touch repeats a decision already on file; the table grows with changes, not traffic. */
    it('drops a signal that repeats what is already on file', async () => {
        (prisma.consent.findFirst as jest.Mock).mockResolvedValue({
            trackingConsent: 'granted',
            marketingConsent: null,
            consentSource: 'cmp_banner'
        });

        await expect(service.record(signal())).resolves.toBe('unchanged');
        expect(create).not.toHaveBeenCalled();
    });

    it('records a withdrawal as a new row carrying its timestamp, never as an edit', async () => {
        (prisma.consent.findFirst as jest.Mock).mockResolvedValue({
            trackingConsent: 'granted',
            marketingConsent: null,
            consentSource: 'cmp_banner'
        });

        await expect(service.record(signal({ trackingConsent: 'denied' }))).resolves.toBe('recorded');
        expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ trackingConsent: 'denied', withdrawnAt: NOW }) });
    });

    it('matches the subject on the email hash when there is one, and on the client’s id otherwise', async () => {
        await service.record(signal());
        await service.record(signal({ subjectEmailHash: null, subjectExternalId: 'cust-9' }));

        const [first, second] = (prisma.consent.findFirst as jest.Mock).mock.calls.map(([args]) => args.where);
        expect(first).toEqual({ tenantId: TENANT, subjectEmailHash: HASH });
        expect(second).toEqual({ tenantId: TENANT, subjectExternalId: 'cust-9' });
    });

    it.each([
        ['a status that is not one of the three', signal({ trackingConsent: 'maybe' })],
        ['no subject at all', signal({ subjectEmailHash: null })]
    ])('ignores %s', async (_case, input) => {
        await expect(service.record(input)).resolves.toBe('ignored');
        expect(create).not.toHaveBeenCalled();
    });
});

describe('ConsentConsumer — reading consent off the bus', () => {
    let consent: MockProxy<ConsentService>;
    let consumer: ConsentConsumer;

    beforeEach(() => {
        consent = mock<ConsentService>();
        consent.record.mockResolvedValue('recorded');
        consumer = new ConsentConsumer(consent, new JsonService(), logger());
    });

    const deliver = (body: unknown) => consumer.handle({ Body: JSON.stringify(body) });

    it('hashes the invitee’s address and passes the hash on, never the address', async () => {
        await deliver({
            event_type: 'referral.link.clicked',
            occurred_at: NOW.toISOString(),
            tenant: { tenant_id: TENANT },
            consent: { tracking_consent: 'granted', marketing_consent: 'denied', consent_source: 'cmp_banner' },
            invitee_email: EMAIL
        });

        expect(consent.record).toHaveBeenCalledWith({
            tenantId: TENANT,
            subjectEmailHash: HASH,
            subjectExternalId: null,
            trackingConsent: 'granted',
            marketingConsent: 'denied',
            consentSource: 'cmp_banner',
            recordedAt: NOW
        });
    });

    /** Ingestion publishes the canonical envelope and the flat keys it has always emitted (§2.6). */
    it('reads the flat keys too, which ingestion still publishes alongside the envelope', async () => {
        await deliver({ tenantId: TENANT, consent_status: 'denied', occurred_at: NOW.toISOString(), invitee_external_id: 'cust-9' });

        expect(consent.record).toHaveBeenCalledWith(expect.objectContaining({ trackingConsent: 'denied', subjectExternalId: 'cust-9' }));
    });

    it.each([
        ['an event with no consent block', { tenant: { tenant_id: TENANT }, event_type: 'reward.earned' }],
        ['an event with no tenant', { consent: { tracking_consent: 'granted' } }]
    ])('passes over %s without failing the message', async (_case, body) => {
        await expect(deliver(body)).resolves.toBeUndefined();
        expect(consent.record).not.toHaveBeenCalled();
    });

    it('passes over a body that is not JSON at all', async () => {
        await expect(consumer.handle({ Body: 'not json' })).resolves.toBeUndefined();
        expect(consent.record).not.toHaveBeenCalled();
    });

    it('falls back to the event’s own time when the capture time is missing or unusable', async () => {
        jest.useFakeTimers().setSystemTime(NOW);
        await deliver({ tenant: { tenant_id: TENANT }, consent: { tracking_consent: 'granted' }, invitee_email: EMAIL });

        expect(consent.record).toHaveBeenCalledWith(expect.objectContaining({ recordedAt: NOW }));
        jest.useRealTimers();
    });
});
