import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma-gen/generated/client';
import { ulid } from 'ulid';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { DatabaseService } from '@app/database/database.service';
import type { BaseDomainEvent } from '@domains/common/events';

import { isPublishedEvent, PublishedEventDraft, toPublishedEvents } from './published-events';

export const PRODUCING_SERVICE = 'tenant-service';

/** Marks an in-process event whose outbox rows were already written inside its transaction. */
const OUTBOX_WRITTEN = Symbol('outboxWritten');

type OutboxClient = Pick<Prisma.TransactionClient, 'eventOutbox'>;
type Flaggable = BaseDomainEvent & { [OUTBOX_WRITTEN]?: true };

/**
 * Turns publishable domain events into `event_outbox` rows (DB Model v2 §0.6) carrying the canonical
 * Event Model v3 envelope.
 *
 * - Inside a transaction: rows are written with the transaction client just before commit, so the event
 *   exists if and only if the state change does.
 * - Outside a transaction: rows are written when the event is emitted (right after the single-statement
 *   change it describes committed).
 *
 * Idempotent: `(tenant_id, event_type, external_id)` is unique and duplicates are skipped.
 */
@Injectable()
export class EventOutboxWriter implements OnModuleInit {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(EventOutboxWriter.name);
    }

    onModuleInit(): void {
        this.txEventEmitter.registerBeforeCommitHook(async (tx, events) => {
            const publishable = events
                .map(({ payload }) => ({ event: (payload as BaseDomainEvent)?.eventType, payload }))
                .filter(({ event }) => typeof event === 'string' && isPublishedEvent(event));
            await this.write(tx, publishable);
            publishable.forEach(({ payload }) => ((payload as Flaggable)[OUTBOX_WRITTEN] = true));
        });
    }

    /** Events emitted outside a transaction (or not yet written) are recorded here. */
    @OnEvent('**', { async: true })
    async onEmitted(payload: unknown): Promise<void> {
        const event = payload as Flaggable | undefined;
        if (!event || typeof event !== 'object' || event[OUTBOX_WRITTEN] || !event.eventType || !isPublishedEvent(event.eventType)) {
            return;
        }
        try {
            await this.write(this.prisma, [{ event: event.eventType, payload: event }]);
        } catch (error) {
            this.logger.error('Could not record a published event in the outbox', error instanceof Error ? error.stack : undefined, {
                eventType: event.eventType,
                eventId: event.eventId,
                tenantId: event.tenantId
            });
        }
    }

    async write(client: OutboxClient, events: Array<{ event: string; payload: unknown }>): Promise<void> {
        const rows = events.flatMap(({ event, payload }) => {
            const domainEvent = payload as BaseDomainEvent;
            return toPublishedEvents(event, payload).map((draft) => this.toRow(domainEvent, draft));
        });
        if (rows.length > 0) {
            await client.eventOutbox.createMany({ data: rows, skipDuplicates: true });
        }
    }

    private toRow(event: BaseDomainEvent, draft: PublishedEventDraft): Prisma.EventOutboxCreateManyInput {
        const eventId = ulid();
        const occurredAt = event.occurredAt ?? new Date();
        const actorId = event.userId && event.userId !== 'system' ? event.userId : null;
        const envelope = {
            event_id: eventId,
            external_id: draft.externalId,
            schema_version: draft.schemaVersion ?? 1,
            event_type: draft.eventType,
            event_class: 'domain',
            occurred_at: occurredAt.toISOString(),
            ingested_at: new Date().toISOString(),
            source: { origin: 'platform_service', trust_level: 'high', producing_service: PRODUCING_SERVICE },
            tenant: { tenant_id: event.tenantId },
            actor: actorId ? { actor_type: 'operator', actor_id: actorId } : { actor_type: 'system' },
            object: { object_type: draft.object.type, object_id: draft.object.id },
            attribution_context: null,
            properties: draft.properties,
            metadata: { correlation_id: this.tenantContext.getCorrelationId() ?? null, request_id: this.tenantContext.getRequestId() ?? null }
        };
        return {
            id: eventId,
            tenantId: event.tenantId,
            eventType: draft.eventType,
            externalId: draft.externalId,
            schemaVersion: envelope.schema_version,
            aggregateType: draft.object.type,
            aggregateId: draft.object.id,
            payload: envelope,
            occurredAt
        };
    }
}
