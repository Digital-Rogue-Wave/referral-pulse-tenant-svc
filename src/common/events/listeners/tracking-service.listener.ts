import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { BaseDomainEvent } from '@domains/common/events';
import { ANALYTICS_SVC_FIFO, AnalyticsSqsEvents } from '@app/types';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { SideEffectService } from '@common/side-effects/side-effect.service';

/**
 * Tracking Service Listener (Analytics/Clickhouse)
 *
 * Async Communication: SQS
 * Purpose: Send all domain events to tracking service for analytics, reporting, and BI
 *
 * This listener captures ALL domain events and sends them to the tracking service
 * (e.g., Clickhouse, data warehouse) via SQS for event tracking and business intelligence.
 *
 * Delivery: Non-critical (direct SQS with DLQ)
 * - Events are emitted after commit, so outbox pattern not needed
 * - Minimal data loss acceptable for analytics
 * - DLQ monitors failures
 */
@Injectable()
export class TrackingServiceListener {
    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly logger: AppLoggerService,
        private readonly redisKeyBuilder: RedisKeyBuilder
    ) {
        this.logger.setContext(TrackingServiceListener.name);
    }

    /**
     * Wildcard listener for ALL domain events → tracking service (async SQS)
     * Captures every event across all domains for comprehensive analytics
     *
     * Pattern: '**' matches all events (e.g., 'toto.created', 'user.updated', etc.)
     */
    @OnEvent('**', { async: true })
    async sendToTrackingService(event: BaseDomainEvent): Promise<void> {
        try {
            // ASYNC: Send to tracking service via SQS (non-critical - direct with DLQ)
            await this.sideEffectService.createSqsSideEffect(
                'tracking',
                event.aggregateId,
                AnalyticsSqsEvents.EVENT,
                ANALYTICS_SVC_FIFO,
                {
                    eventId: event.eventId,
                    eventType: event.eventType,
                    aggregateId: event.aggregateId,
                    tenantId: event.tenantId,
                    occurredAt: event.occurredAt,
                    userId: event.userId,
                    payload: event,
                    // Additional analytics metadata
                    metadata: {
                        source: 'referral-pulse',
                        environment: process.env.NODE_ENV
                    }
                },
                {
                    critical: false, // Direct SQS with DLQ (after commit)
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(`tracking-${event.eventId}`)
                }
            );

            this.logger.debug(`Sent ${event.eventType} to tracking service (async SQS)`, {
                eventId: event.eventId,
                queue: ANALYTICS_SVC_FIFO
            });
        } catch (error) {
            // Minimal loss acceptable for tracking, DLQ monitors failures
            this.logger.warn(`Failed to send ${event.eventType} to tracking service (check DLQ)`, {
                eventId: event.eventId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
