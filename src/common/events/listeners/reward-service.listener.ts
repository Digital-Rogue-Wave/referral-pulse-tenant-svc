import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { BaseDomainEvent } from '@domains/common/events';
import { TotoCreatedEvent } from '@domains/toto';
import { REWARD_SVC_FIFO } from '@app/types';
import { ReferralEvents } from '@domains/referral';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { SideEffectService } from '@common/side-effects/side-effect.service';

/**
 * Reward Service Listener
 *
 * Communication Pattern: ASYNC (SQS only)
 * Purpose: Trigger reward calculations and distributions based on domain events
 *
 * Examples:
 * - User signs up → welcome reward
 * - Referral converts → referrer reward
 * - Campaign milestone reached → bonus reward
 *
 * Delivery: Non-critical (direct SQS with DLQ)
 * - Events are emitted after commit, so outbox pattern not needed
 * - DLQ provides failure recovery
 */
@Injectable()
export class RewardServiceListener {
    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly logger: AppLoggerService,
        private readonly redisKeyBuilder: RedisKeyBuilder,
    ) {
        this.logger.setContext(RewardServiceListener.name);
    }

    /**
     * ASYNC: Trigger reward calculation for toto.created event
     * Reward service will process this asynchronously and calculate rewards
     */
    @OnEvent('toto.created', { async: true })
    async triggerRewardCalculation(event: TotoCreatedEvent): Promise<void> {
        try {
            // ASYNC: Send to reward service queue (non-critical - direct with DLQ)
            await this.sideEffectService.createSqsSideEffect(
                'reward',
                event.aggregateId,
                ReferralEvents.REWARDED,
                REWARD_SVC_FIFO,
                {
                    eventType: event.eventType,
                    aggregateId: event.aggregateId,
                    tenantId: event.tenantId,
                    userId: event.userId,
                    timestamp: event.occurredAt,
                    metadata: {
                        resourceType: 'toto',
                        name: event.name,
                        status: event.status,
                    },
                },
                {
                    critical: false, // Direct SQS with DLQ (after commit)
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(`reward-calc-${event.aggregateId}`),
                },
            );

            this.logger.debug(`Triggered reward calculation (async SQS)`, {
                eventId: event.eventId,
                totoId: event.aggregateId,
                queue: REWARD_SVC_FIFO,
            });
        } catch (error) {
            this.logger.error(
                `Failed to trigger reward calculation (check DLQ)`,
                error instanceof Error ? error.stack : undefined,
                {
                    eventId: event.eventId,
                    totoId: event.aggregateId,
                },
            );
        }
    }

    /**
     * ASYNC: Track user activity for reward eligibility
     * Helps reward service determine if user qualifies for activity-based rewards
     */
    @OnEvent('user.*', { async: true })
    async trackUserActivity(event: BaseDomainEvent): Promise<void> {
        try {
            // ASYNC: Send user activity to reward service queue (non-critical - direct with DLQ)
            await this.sideEffectService.createSqsSideEffect(
                'reward',
                event.aggregateId,
                ReferralEvents.REWARDED,
                REWARD_SVC_FIFO,
                {
                    eventType: event.eventType,
                    userId: event.aggregateId,
                    tenantId: event.tenantId,
                    timestamp: event.occurredAt,
                    activity: {
                        type: event.getEventAction(), // e.g., 'created', 'updated'
                        metadata: event,
                    },
                },
                {
                    critical: false, // Direct SQS with DLQ (after commit)
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(
                        `reward-activity-${event.aggregateId}-${event.eventId}`,
                    ),
                },
            );

            this.logger.debug(`Tracked user activity for rewards (async SQS)`, {
                eventType: event.eventType,
                userId: event.aggregateId,
            });
        } catch (error) {
            this.logger.warn(`Failed to track user activity for rewards (check DLQ)`, {
                eventType: event.eventType,
                eventId: event.eventId,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
}
