import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';

import { BaseDomainEvent } from '@domains/common/events';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { SideEffectService } from '@common/side-effects/side-effect.service';

import { AllConfigType } from '@config/config.type';
import { ANALYTICS_SVC_FIFO, AnalyticsSqsEvents } from '@app/types';

/**
 * Analytics Service Listener
 *
 * Async Communication: SQS
 * Purpose: Send analytics-scoped domain events to analytics service for reporting and BI
 *
 * Captures events matching 'analytics.*' and forwards them to the analytics service
 * via SQS for dashboards, metrics, and business intelligence.
 *
 * Delivery: Non-critical (direct SQS with DLQ)
 * - Events are emitted after commit, so outbox pattern not needed
 * - Minimal data loss acceptable for analytics
 * - DLQ monitors failures
 */
@Injectable()
export class AnalyticsListener {
    private readonly serviceName: string;

    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly logger: AppLoggerService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly redisKeyBuilder: RedisKeyBuilder
    ) {
        this.logger.setContext(AnalyticsListener.name);
        this.serviceName = this.configService.get('app.name', { infer: true }) || 'unknown-service';
    }

    /**
     * Listener for analytics domain events → analytics service (async SQS)
     *
     * Pattern: 'analytics.*' matches events like 'analytics.pageview', 'analytics.conversion', etc.
     */
    @OnEvent('analytics.*', { async: true })
    async handleAnalyticsEvent(event: BaseDomainEvent): Promise<void> {
        try {
            await this.sideEffectService.createSqsSideEffect(
                'analytics',
                event.aggregateId,
                AnalyticsSqsEvents.EVENT,
                ANALYTICS_SVC_FIFO,
                {
                    service: this.serviceName,
                    eventId: event.eventId,
                    eventType: event.eventType,
                    aggregateId: event.aggregateId,
                    tenantId: event.tenantId,
                    userId: event.userId,
                    occurredAt: event.occurredAt
                },
                {
                    critical: false,
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(`analytics-${event.eventId}`)
                }
            );

            this.logger.debug(`Sent ${event.eventType} to analytics service`, {
                eventId: event.eventId,
                aggregateId: event.aggregateId
            });
        } catch (error) {
            this.logger.warn(`Failed to send ${event.eventType} to analytics service (check DLQ)`, {
                eventId: event.eventId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    // 4165981587944343    03/29   452
}
