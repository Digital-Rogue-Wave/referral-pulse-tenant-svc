import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { CAMPAIGN_SVC_FIFO } from '@app/types';
import { CampaignEvents } from '@domains/campaign';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { SideEffectService } from '@common/side-effects/side-effect.service';
import { TotoCreatedEvent, TotoUpdatedEvent } from '@domains/toto/events/toto.events';

/**
 * Campaign Service Listener
 *
 * Communication Pattern: ASYNC only (SQS)
 * Purpose: Notify campaign service about events that may trigger campaigns
 * or update campaign statistics.
 *
 * IMPORTANT: All external calls MUST be async via SideEffectService.
 * Never make synchronous HTTP calls from event listeners.
 *
 * Delivery: Non-critical (direct SQS with DLQ)
 * - Events are emitted after commit, so outbox pattern not needed
 * - DLQ provides failure recovery
 */
@Injectable()
export class CampaignServiceListener {
    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly logger: AppLoggerService,
        private readonly redisKeyBuilder: RedisKeyBuilder,
    ) {
        this.logger.setContext(CampaignServiceListener.name);
    }

    /**
     * ASYNC: Send toto.created event to campaign service via SQS
     * Campaign service may trigger automated campaigns based on this event
     */
    @OnEvent('toto.created', { async: true })
    async handleTotoCreated(event: TotoCreatedEvent): Promise<void> {
        try {
            await this.sideEffectService.createSqsSideEffect(
                'campaign',
                event.aggregateId,
                CampaignEvents.CREATED,
                CAMPAIGN_SVC_FIFO,
                {
                    totoId: event.aggregateId,
                    name: event.name,
                    status: event.status,
                    tenantId: event.tenantId,
                    userId: event.userId,
                    createdAt: event.occurredAt,
                },
                {
                    critical: false,
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(
                        `campaign-toto-created-${event.aggregateId}`,
                    ),
                },
            );

            this.logger.debug(`Sent toto.created to campaign service`, {
                eventId: event.eventId,
                totoId: event.aggregateId,
            });
        } catch (error) {
            this.logger.error(
                `Failed to send toto.created to campaign service (check DLQ)`,
                error instanceof Error ? error.stack : undefined,
                {
                    eventId: event.eventId,
                },
            );
        }
    }

    /**
     * ASYNC: Send toto.updated event to campaign service via SQS
     * Campaign service will handle any campaign-related logic asynchronously
     */
    @OnEvent('toto.updated', { async: true })
    async handleTotoUpdated(event: TotoUpdatedEvent): Promise<void> {
        try {
            await this.sideEffectService.createSqsSideEffect(
                'campaign',
                event.aggregateId,
                CampaignEvents.UPDATED,
                CAMPAIGN_SVC_FIFO,
                {
                    totoId: event.aggregateId,
                    changes: event.changes,
                    tenantId: event.tenantId,
                    userId: event.userId,
                    updatedAt: event.occurredAt,
                },
                {
                    critical: false,
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(
                        `campaign-toto-updated-${event.aggregateId}-${event.eventId}`,
                    ),
                },
            );

            this.logger.debug(`Sent toto.updated to campaign service`, {
                eventId: event.eventId,
                totoId: event.aggregateId,
            });
        } catch (error) {
            this.logger.warn(`Failed to send toto.updated to campaign service (check DLQ)`, {
                eventId: event.eventId,
                totoId: event.aggregateId,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
}
