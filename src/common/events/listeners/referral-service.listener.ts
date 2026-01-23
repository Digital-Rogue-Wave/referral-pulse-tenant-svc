import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { SideEffectService } from '@app/common/side-effects/side-effect.service';
import { BaseDomainEvent } from '@app/common/events/base-domain.event';

/**
 * Referral Service Listener
 *
 * Communication Pattern: ASYNC (SQS only)
 * Purpose: Track referrals, conversions, and referral campaign performance
 *
 * Examples:
 * - User signs up via referral link → track referral
 * - User converts → update referral conversion stats
 * - Referrer gets rewarded → update referral performance
 *
 * Delivery: Non-critical (direct SQS with DLQ)
 * - Events are emitted after commit, so outbox pattern not needed
 * - DLQ provides failure recovery
 */
@Injectable()
export class ReferralServiceListener {
    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(ReferralServiceListener.name);
    }

    /**
     * ASYNC: Track user signup for referral attribution
     * Checks if user signed up via referral link and attributes the referral
     */
    @OnEvent('user.created', { async: true })
    async trackReferralSignup(event: BaseDomainEvent & { email?: string; source?: string; referralCode?: string }): Promise<void> {
        try {
            // ASYNC: Send to referral service queue for referral attribution (non-critical - direct with DLQ)
            await this.sideEffectService.createSqsSideEffect(
                'referral',
                event.aggregateId,
                'referral.created',
                'referral-events-queue',
                {
                    userId: event.aggregateId,
                    tenantId: event.tenantId,
                    email: event.email,
                    signupSource: event.source,
                    referralCode: event.referralCode,
                    timestamp: event.occurredAt,
                },
                {
                    critical: false, // Direct SQS with DLQ (after commit)
                    idempotencyKey: `referral-signup-${event.aggregateId}`,
                },
            );

            this.logger.debug(`Tracked referral signup (async SQS)`, {
                eventId: event.eventId,
                userId: event.aggregateId,
                queue: 'referral-events-queue',
            });
        } catch (error) {
            this.logger.error(
                `Failed to track referral signup (check DLQ)`,
                error instanceof Error ? error.stack : undefined,
                {
                    eventId: event.eventId,
                    userId: event.aggregateId,
                },
            );
        }
    }

    /**
     * ASYNC: Track referral conversion events
     * Updates referral conversion statistics and triggers rewards
     */
    @OnEvent('referral.converted', { async: true })
    async trackReferralConversion(event: BaseDomainEvent & { referrerId?: string; referredUserId?: string; conversionType?: string; conversionValue?: number }): Promise<void> {
        try {
            // ASYNC: Send conversion event to referral service queue (non-critical - direct with DLQ)
            await this.sideEffectService.createSqsSideEffect(
                'referral',
                event.aggregateId,
                'referral.converted',
                'referral-conversions-queue',
                {
                    referralId: event.aggregateId,
                    referrerId: event.referrerId,
                    referredUserId: event.referredUserId,
                    tenantId: event.tenantId,
                    conversionType: event.conversionType,
                    conversionValue: event.conversionValue,
                    timestamp: event.occurredAt,
                },
                {
                    critical: false, // Direct SQS with DLQ (after commit)
                    idempotencyKey: `referral-conversion-${event.aggregateId}`,
                },
            );

            this.logger.log(`Tracked referral conversion (async SQS)`, {
                eventId: event.eventId,
                referralId: event.aggregateId,
                conversionType: event.conversionType,
            });
        } catch (error) {
            this.logger.error(
                `Failed to track referral conversion (check DLQ)`,
                error instanceof Error ? error.stack : undefined,
                {
                    eventId: event.eventId,
                    referralId: event.aggregateId,
                },
            );
        }
    }

    /**
     * ASYNC: Track campaign engagement for referral attribution
     * Helps referral service attribute campaign performance to referrers
     */
    @OnEvent('campaign.*', { async: true })
    async trackCampaignEngagement(event: BaseDomainEvent): Promise<void> {
        try {
            // ASYNC: Send campaign engagement to referral service queue (non-critical - direct with DLQ)
            await this.sideEffectService.createSqsSideEffect(
                'referral',
                event.aggregateId,
                'referral.clicked',
                'referral-activity-queue',
                {
                    eventType: event.eventType,
                    campaignId: event.aggregateId,
                    tenantId: event.tenantId,
                    userId: event.userId,
                    timestamp: event.occurredAt,
                    metadata: {
                        action: event.eventType.split('.')[1],
                        details: event,
                    },
                },
                {
                    critical: false, // Direct SQS with DLQ (after commit)
                    idempotencyKey: `referral-campaign-${event.aggregateId}-${event.eventId}`,
                },
            );

            this.logger.debug(`Tracked campaign engagement for referrals (async SQS)`, {
                eventType: event.eventType,
                campaignId: event.aggregateId,
            });
        } catch (error) {
            this.logger.warn(
                `Failed to track campaign engagement for referrals (check DLQ)`,
                {
                    eventType: event.eventType,
                    eventId: event.eventId,
                    error: error instanceof Error ? error.message : 'Unknown error',
                },
            );
        }
    }
}