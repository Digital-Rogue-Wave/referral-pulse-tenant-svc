import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma-gen/generated/client';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { sha256Hex } from '@common/helper/hashing';
import { DatabaseService } from '@app/database/database.service';
import type { BaseDomainEvent } from '@domains/common/events';

import { auditActor, toAuditEntry } from './audited-actions';

/** Marks an in-process event whose audit row was already written inside its transaction. */
const AUDIT_WRITTEN = Symbol('auditWritten');

type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;
type Flaggable = BaseDomainEvent & { [AUDIT_WRITTEN]?: true };

/**
 * Records operator actions in `audit_log` from the domain events services already emit.
 *
 * - Inside a transaction: written just before commit with the transaction client, so an action is audited
 *   if and only if it happened.
 * - Outside a transaction: written when the event is emitted, right after its single-statement change.
 *
 * The row id is the domain event id, so a trail row can be matched to the outbox row of the same fact.
 */
@Injectable()
export class AuditLogWriter implements OnModuleInit {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly context: TenantContextService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(AuditLogWriter.name);
    }

    onModuleInit(): void {
        this.txEventEmitter.registerBeforeCommitHook(async (tx, events) => {
            const domainEvents = events.map(({ payload }) => payload).filter(isDomainEvent);
            await this.write(tx, domainEvents);
            domainEvents.forEach((event) => (event[AUDIT_WRITTEN] = true));
        });
    }

    @OnEvent('**', { async: true })
    async onEmitted(payload: unknown): Promise<void> {
        if (!isDomainEvent(payload) || payload[AUDIT_WRITTEN]) {
            return;
        }
        payload[AUDIT_WRITTEN] = true;
        try {
            await this.write(this.prisma, [payload]);
        } catch (error) {
            this.logger.error('Could not record an operator action in the audit log', error instanceof Error ? error.stack : undefined, {
                eventType: payload.eventType,
                eventId: payload.eventId,
                tenantId: payload.tenantId
            });
        }
    }

    async write(client: AuditClient, events: BaseDomainEvent[]): Promise<void> {
        const rows = events.flatMap((event) => this.toRow(event) ?? []);
        if (rows.length > 0) {
            await client.auditLog.createMany({ data: rows, skipDuplicates: true });
        }
    }

    private toRow(event: BaseDomainEvent): Prisma.AuditLogCreateManyInput | null {
        const actor = auditActor(event);
        const entry = actor ? toAuditEntry(event) : null;
        if (!actor || !entry || !event.tenantId) {
            return null;
        }
        const ip = this.context.getIp();
        return {
            id: event.eventId,
            tenantId: event.tenantId,
            actorUserId: actor,
            action: entry.action,
            targetType: entry.targetType,
            targetId: entry.targetId,
            reason: entry.reason,
            requestId: this.context.getRequestId() ?? null,
            ipHash: ip ? sha256Hex(ip) : null,
            before: entry.before ?? undefined,
            after: entry.after ?? undefined,
            occurredAt: event.occurredAt ?? new Date()
        };
    }
}

function isDomainEvent(value: unknown): value is Flaggable {
    return typeof value === 'object' && value !== null && typeof (value as BaseDomainEvent).eventType === 'string';
}
