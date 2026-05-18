import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';

import { BaseDomainEvent } from '@domains/common/events';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { SideEffectService } from '@common/side-effects/side-effect.service';

import { AllConfigType } from '@config/config.type';
import { AUDIT_TRAIL_FIFO, AuditSqsEvents } from '@app/types';

/**
 * Functional audit trail via direct SQS to audit service
 * DLQ monitoring for compliance
 *
 * This listener captures ALL domain events and sends them to the audit trail service
 * for compliance, regulatory requirements, and functional auditing.
 * Uses wildcard listener to ensure no events are missed.
 *
 * Delivery: Non-critical (direct SQS with DLQ)
 * - Events are emitted after commit, so outbox pattern not needed
 * - DLQ provides failure recovery for compliance
 */
@Injectable()
export class AuditTrailListener {
    private readonly serviceName: string;

    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly logger: AppLoggerService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly redisKeyBuilder: RedisKeyBuilder,
    ) {
        this.logger.setContext(AuditTrailListener.name);
        this.serviceName = this.configService.get('app.name', { infer: true }) || 'unknown-service';
    }

    /**
     * Wildcard listener for ALL domain events → audit service
     * Ensures compliance by capturing all domain changes
     *
     * Pattern: '**' matches all events (e.g., 'toto.created', 'user.updated', etc.)
     */
    @OnEvent('audit.*', { async: true })
    async auditAllEvents(event: BaseDomainEvent): Promise<void> {
        try {
            // Send to audit trail service queue (non-critical - direct SQS with DLQ)
            await this.sideEffectService.createSqsSideEffect(
                'audit',
                event.aggregateId,
                AuditSqsEvents.EVENT,
                AUDIT_TRAIL_FIFO,
                {
                    service: this.serviceName,
                    eventId: event.eventId,
                    eventType: event.eventType,
                    aggregateId: event.aggregateId,
                    tenantId: event.tenantId,
                    userId: event.userId,
                    occurredAt: event.occurredAt,
                    // Include full event payload for audit trail
                    payload: event,
                },
                {
                    critical: false, // Direct SQS with DLQ (after commit)
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(`audit-${event.eventId}`),
                },
            );

            this.logger.debug(`Sent ${event.eventType} to audit service`, {
                eventId: event.eventId,
                aggregateId: event.aggregateId,
            });
        } catch (error) {
            // DLQ for compliance monitoring - don't lose audit events
            this.logger.error(
                `Failed to send ${event.eventType} to audit service (check DLQ)`,
                error instanceof Error ? error.stack : undefined,
                {
                    eventId: event.eventId,
                },
            );
        }
    }
}
