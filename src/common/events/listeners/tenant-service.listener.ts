import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { BaseDomainEvent } from '@domains/common/events';
import { TENANT_SVC_FIFO, AnalyticsSqsEvents } from '@app/types';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { SideEffectService } from '@common/side-effects/side-effect.service';

/**
 * Tenant Service Listener
 *
 * Communication Pattern: ASYNC only (SQS)
 * Purpose: Track tenant usage and resource changes.
 *
 * IMPORTANT: All external calls MUST be async via SideEffectService.
 * Never make synchronous HTTP calls from event listeners.
 * Quota validation should happen BEFORE entity creation in the service layer,
 * not after in event listeners.
 *
 * Delivery: Non-critical (direct SQS with DLQ)
 * - Events are emitted after commit, so outbox pattern not needed
 * - DLQ provides failure recovery
 */
@Injectable()
export class TenantServiceListener {
    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly logger: AppLoggerService,
        private readonly redisKeyBuilder: RedisKeyBuilder,
    ) {
        this.logger.setContext(TenantServiceListener.name);
    }

    /**
     * ASYNC: Track tenant usage via SQS
     * Updates tenant usage statistics and quotas
     */
    @OnEvent('toto.created', { async: true })
    async trackTenantUsage(event: BaseDomainEvent): Promise<void> {
        try {
            await this.sideEffectService.createSqsSideEffect(
                'tenant',
                event.tenantId,
                AnalyticsSqsEvents.EVENT,
                TENANT_SVC_FIFO,
                {
                    tenantId: event.tenantId,
                    userId: event.userId,
                    resourceType: 'toto',
                    resourceId: event.aggregateId,
                    action: 'created',
                    timestamp: event.occurredAt,
                },
                {
                    critical: false,
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(
                        `tenant-usage-${event.tenantId}-${event.aggregateId}`,
                    ),
                },
            );

            this.logger.debug(`Sent usage tracking to tenant service`, {
                eventId: event.eventId,
                tenantId: event.tenantId,
                resourceType: 'toto',
            });
        } catch (error) {
            this.logger.warn(`Failed to send usage tracking to tenant service (check DLQ)`, {
                eventId: event.eventId,
                tenantId: event.tenantId,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    /**
     * ASYNC: Track tenant resource deletion
     * Updates tenant usage when resources are deleted
     */
    @OnEvent('toto.deleted', { async: true })
    async trackTenantResourceDeletion(event: BaseDomainEvent): Promise<void> {
        try {
            await this.sideEffectService.createSqsSideEffect(
                'tenant',
                event.tenantId,
                AnalyticsSqsEvents.EVENT,
                TENANT_SVC_FIFO,
                {
                    tenantId: event.tenantId,
                    userId: event.userId,
                    resourceType: 'toto',
                    resourceId: event.aggregateId,
                    action: 'deleted',
                    timestamp: event.occurredAt,
                },
                {
                    critical: false,
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(
                        `tenant-usage-delete-${event.tenantId}-${event.aggregateId}`,
                    ),
                },
            );

            this.logger.debug(`Sent deletion tracking to tenant service`, {
                eventId: event.eventId,
                tenantId: event.tenantId,
                resourceType: 'toto',
            });
        } catch (error) {
            this.logger.warn(`Failed to send deletion tracking to tenant service (check DLQ)`, {
                eventId: event.eventId,
                tenantId: event.tenantId,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
}
