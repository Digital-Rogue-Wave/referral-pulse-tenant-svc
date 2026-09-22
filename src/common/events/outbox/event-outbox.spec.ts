import { mock, MockProxy } from 'jest-mock-extended';
import type { Prisma } from '@prisma-gen/generated/client';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { DomainMetrics } from '@common/monitoring/domain-metrics.service';
import { SnsPublisherService } from '@common/messaging/sns-publisher.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { BeforeCommitHook, TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { DatabaseService } from '@app/database/database.service';
import { ApiKeyDeletedEvent } from '@domains/api-key';
import { TenantPaymentStatusChangedEvent } from '@domains/billing';
import { TenantCreatedEvent, TenantLockedEvent } from '@domains/tenant/events/tenant.events';
import { UserRegisteredEvent } from '@domains/user';
import { TENANT_EVENTS_TOPIC } from '@app/types';

import { EventOutboxRelayWorker } from './event-outbox-relay.worker';
import { EventOutboxWriter } from './event-outbox.writer';
import { isPublishedEvent, toPublishedEvents } from './published-events';

describe('Published events registry', () => {
    it('publishes the Event Model v2.1 §4.12 identity events with their spec properties', () => {
        const [registered] = toPublishedEvents('user.registered', new UserRegisteredEvent('u1', 't1', 'OWNER'));
        expect(registered).toMatchObject({
            eventType: 'user.registered',
            externalId: 'user.registered:u1',
            properties: { user_id: 'u1', tenant_id: 't1', role: 'owner' }
        });

        const [revoked] = toPublishedEvents(
            'api-key.deleted',
            new ApiKeyDeletedEvent('k1', 't1', {
                apiKeyId: 'k1',
                tenantId: 't1',
                keyLabel: 'ci',
                keyPrefix: 'abcd',
                deletedBy: 'u1',
                deletedAt: new Date(),
                reason: 'leaked'
            })
        );
        expect(revoked).toMatchObject({ eventType: 'api_key.revoked', properties: { key_id: 'k1', revoked_by: 'u1', revocation_reason: 'leaked' } });
    });

    it('uses snake_case actions on the wire and never nests objects in properties (Event Model v3 §2.5)', () => {
        const drafts = [
            ...toPublishedEvents('tenant.created', new TenantCreatedEvent('t1', 't1', 'Acme', 'acme', 'k1', new Date(), new Date())),
            ...toPublishedEvents('tenant.locked', new TenantLockedEvent('t1', 't1', 'security', new Date()))
        ];
        for (const draft of drafts) {
            expect(draft.eventType).toMatch(/^[a-z_]+\.[a-z_]+$/);
            for (const [key, value] of Object.entries(draft.properties)) {
                expect(key).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
                expect(value === null || ['string', 'number', 'boolean'].includes(typeof value)).toBe(true);
            }
        }
    });

    it('keeps a tenant self-lock distinct from a lock for non-payment', () => {
        const payment = toPublishedEvents(
            'tenant.payment-status-changed',
            new TenantPaymentStatusChangedEvent('t1', 't1', 'restricted', 'locked', new Date().toISOString())
        );
        expect(payment.map((d) => d.eventType)).toEqual(['tenant.payment_status_changed', 'tenant.payment_locked']);
        expect(toPublishedEvents('tenant.locked', new TenantLockedEvent('t1', 't1', 'r', new Date()))[0]!.eventType).toBe('tenant.locked');
    });

    it('announces a restored payment only when it was not already active', () => {
        const restored = toPublishedEvents(
            'tenant.payment-status-changed',
            new TenantPaymentStatusChangedEvent('t1', 't1', 'past_due', 'active', new Date().toISOString())
        );
        expect(restored.map((d) => d.eventType)).toEqual(['tenant.payment_status_changed', 'payment.restored', 'tenant.payment_restored']);
    });

    it('leaves in-process events unpublished', () => {
        expect(isPublishedEvent('api-key.updated')).toBe(false);
        expect(toPublishedEvents('invitation.created', {})).toEqual([]);
    });
});

describe('EventOutboxWriter', () => {
    let hook: BeforeCommitHook;
    let writer: EventOutboxWriter;
    let createMany: jest.Mock;

    beforeEach(() => {
        createMany = jest.fn();
        const txEmitter = mock<TransactionEventEmitterService>();
        txEmitter.registerBeforeCommitHook.mockImplementation((registered) => {
            hook = registered;
        });
        const context = mock<TenantContextService>();
        context.getCorrelationId.mockReturnValue('corr-1');
        context.getRequestId.mockReturnValue('req_1');
        const prisma = { eventOutbox: { createMany } } as unknown as DatabaseService;
        writer = new EventOutboxWriter(prisma, txEmitter, context, mock<AppLoggerService>());
        writer.onModuleInit();
    });

    it('writes publishable events with the transaction client, inside the transaction, as canonical v3 envelopes', async () => {
        const txCreateMany = jest.fn();
        const event = new UserRegisteredEvent('u1', 't1', 'ADMIN', 'actor-1');

        await hook({ eventOutbox: { createMany: txCreateMany } } as unknown as Prisma.TransactionClient, [
            { event: 'user.registered', payload: event },
            { event: 'api-key.updated', payload: { eventType: 'api-key.updated' } }
        ]);

        expect(createMany).not.toHaveBeenCalled();
        const { data, skipDuplicates } = txCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>>; skipDuplicates: boolean };
        expect(skipDuplicates).toBe(true);
        expect(data).toHaveLength(1);
        expect(data[0]).toMatchObject({
            tenantId: 't1',
            eventType: 'user.registered',
            externalId: 'user.registered:u1',
            aggregateType: 'user',
            aggregateId: 'u1'
        });
        expect(data[0]!.payload).toMatchObject({
            event_id: data[0]!.id,
            external_id: 'user.registered:u1',
            schema_version: 1,
            event_class: 'domain',
            source: { origin: 'platform_service', trust_level: 'high', producing_service: 'tenant-service' },
            tenant: { tenant_id: 't1' },
            actor: { actor_type: 'operator', actor_id: 'actor-1' },
            object: { object_type: 'user', object_id: 'u1' },
            properties: { user_id: 'u1', tenant_id: 't1', role: 'admin' },
            metadata: { correlation_id: 'corr-1', request_id: 'req_1' }
        });
    });

    it('does not write the same event again when it is emitted after commit', async () => {
        const event = new UserRegisteredEvent('u1', 't1', 'ADMIN');
        await hook({ eventOutbox: { createMany: jest.fn() } } as unknown as Prisma.TransactionClient, [{ event: 'user.registered', payload: event }]);

        await writer.onEmitted(event);

        expect(createMany).not.toHaveBeenCalled();
    });

    it('records events emitted outside a transaction when they are emitted', async () => {
        await writer.onEmitted(new UserRegisteredEvent('u2', 't1', 'VIEWER'));
        expect(createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ externalId: 'user.registered:u2' })], skipDuplicates: true });
    });
});

describe('EventOutboxRelayWorker', () => {
    type Row = { id: string; tenantId: string; eventType: string; externalId: string; payload: object; attemptCount: number };
    let sns: MockProxy<SnsPublisherService>;
    let updates: Array<{ id: string; data: Record<string, unknown> }>;
    let worker: EventOutboxRelayWorker;
    let pending: Row[];

    beforeEach(() => {
        sns = mock<SnsPublisherService>();
        updates = [];
        pending = [];
        const prisma = {
            eventOutbox: {
                findMany: jest.fn(async () => pending),
                update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
                    updates.push({ id: where.id, data })
                ),
                deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
                count: jest.fn().mockResolvedValue(0),
                findFirst: jest.fn().mockResolvedValue(null)
            }
        };
        const context = { runWithContext: (_ctx: unknown, fn: () => unknown) => fn() };
        worker = Object.create(EventOutboxRelayWorker.prototype) as EventOutboxRelayWorker;
        Object.assign(worker, { prisma, sns, tenantContext: context, logger: mock<AppLoggerService>(), domainMetrics: mock<DomainMetrics>() });
    });

    const run = (name = 'relay') => (worker as unknown as { processJob: (job: { name: string }) => Promise<{ data: unknown }> }).processJob({ name });
    const row = (id: string, tenantId: string, attemptCount = 0): Row => ({
        id,
        tenantId,
        eventType: 'user.registered',
        externalId: `user.registered:${id}`,
        payload: { event_id: id },
        attemptCount
    });

    it('publishes to tenant-events with the event id as dedup id and a business idempotency key, then marks published', async () => {
        pending = [row('e1', 't1')];
        await run();

        expect(sns.publish).toHaveBeenCalledWith(
            TENANT_EVENTS_TOPIC,
            'user.registered',
            { event_id: 'e1' },
            {
                idempotencyKey: 'user.registered:e1',
                messageGroupId: 't1',
                messageDeduplicationId: 'e1'
            }
        );
        expect(updates[0]).toMatchObject({ id: 'e1', data: { status: 'published' } });
    });

    it('holds a tenant’s later events after a failure, so they stay in order, while other tenants continue', async () => {
        pending = [row('e1', 't1'), row('e2', 't1'), row('e3', 't2')];
        sns.publish.mockRejectedValueOnce(new Error('throttled')).mockResolvedValue('m');

        await run();

        expect(sns.publish.mock.calls.map((call) => (call[2] as { event_id: string }).event_id)).toEqual(['e1', 'e3']);
        expect(updates.find((u) => u.id === 'e1')!.data).toMatchObject({ status: 'pending', attemptCount: 1, lastError: 'throttled' });
    });

    it('parks an event as failed after the last attempt', async () => {
        pending = [row('e1', 't1', 9)];
        sns.publish.mockRejectedValue(new Error('topic missing'));

        await run();

        expect(updates[0]!.data).toMatchObject({ status: 'failed', attemptCount: 10 });
    });

    it('prunes published rows past retention', async () => {
        expect((await run('prune')).data).toEqual({ pruned: 3 });
    });
});
