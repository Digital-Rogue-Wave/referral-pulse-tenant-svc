import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';

import { PaymentStatusEnum } from '@common/enums/billing.enum';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { SideEffectService } from '@common/side-effects/side-effect.service';

import { AllConfigType } from '@config/config.type';
import { BroadcastEvent } from '@app/domains/common/events/broadcast.event';
import {
    SubscriptionChangedEvent,
    SubscriptionCreatedEvent,
    SubscriptionDowngradeScheduledEvent,
    SubscriptionUpgradedEvent,
    SubscriptionCancelledEvent,
    TenantPaymentStatusChangedEvent,
    TrialExpiredEvent,
    TrialReminderEvent,
    BillingEvents
} from '@domains/billing';
import { BILLING_EVENTS_TOPIC, type BaseEventType, type SnsTopicName } from '@app/types';

/**
 * Broadcast Event Listener - Cross-Service Event Broadcasting via SNS
 *
 * Handles two patterns:
 * 1. Generic broadcasts: Services emit BroadcastEvent('broadcast', event, topic)
 * 2. Domain-specific broadcasts: Billing events fan-out to SNS topic
 *
 * Subscriber SQS queues are managed via infrastructure (Terraform/CDK),
 * not in application code — adding a new consumer requires zero code changes.
 *
 * Delivery: Fire-and-forget (critical: false)
 * - Direct SNS publish with DLQ fallback on subscriber queues
 * - Events emitted after commit, so outbox not needed
 */
@Injectable()
export class BroadcastEventListener {
    private readonly serviceName: string;

    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly logger: AppLoggerService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly redisKeyBuilder: RedisKeyBuilder
    ) {
        this.logger.setContext(BroadcastEventListener.name);
        this.serviceName = this.configService.get('app.name', { infer: true }) || 'unknown-service';
    }

    // ── Generic broadcast ──────────────────────────────────────────────

    @OnEvent('broadcast', { async: true })
    async handleBroadcast(broadcastEvent: BroadcastEvent): Promise<void> {
        const { event, topicName, broadcastId } = broadcastEvent;

        if (!topicName) {
            this.logger.debug('No topic specified for broadcast', {
                eventType: event.eventType,
                eventId: event.eventId
            });
            return;
        }

        try {
            await this.sideEffectService.createBroadcastSideEffect(
                event.getEventCategory(),
                event.aggregateId,
                event.eventType,
                topicName,
                {
                    source: this.serviceName,
                    broadcastId,
                    eventId: event.eventId,
                    eventType: event.eventType,
                    aggregateId: event.aggregateId,
                    tenantId: event.tenantId,
                    userId: event.userId,
                    occurredAt: event.occurredAt.toISOString(),
                    payload: event
                },
                {
                    critical: false,
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(`broadcast-${event.eventType}-${event.eventId}`),
                    messageGroupId: event.tenantId
                }
            );

            this.logger.debug(`Broadcasted ${event.eventType} to topic ${topicName}`, {
                broadcastId,
                eventId: event.eventId,
                aggregateId: event.aggregateId,
                topicName
            });
        } catch (error) {
            this.logger.warn(`Failed to broadcast ${event.eventType} to ${topicName}`, {
                broadcastId,
                eventId: event.eventId,
                aggregateId: event.aggregateId,
                topicName,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // ── Billing broadcasts ─────────────────────────────────────────────

    @OnEvent('subscription.changed', { async: true })
    @OnEvent('subscription.created', { async: true })
    async handleSubscriptionEvent(event: SubscriptionChangedEvent | SubscriptionCreatedEvent): Promise<void> {
        await this.broadcast('billing', event.eventType, event.tenantId, event.eventId, BILLING_EVENTS_TOPIC, {
            stripeSubscriptionId: event.stripeSubscriptionId,
            stripeCustomerId: event.stripeCustomerId,
            billingPlan: event.billingPlan,
            subscriptionStatus: event.subscriptionStatus,
            currentPeriodStart: event.currentPeriodStart,
            currentPeriodEnd: event.currentPeriodEnd,
            stripeEventId: event.stripeEventId,
            tenantId: event.tenantId,
            userId: event.userId
        });
    }

    @OnEvent('subscription.cancelled', { async: true })
    async handleSubscriptionCancelled(event: SubscriptionCancelledEvent): Promise<void> {
        await this.broadcast('billing', event.eventType, event.tenantId, event.eventId, BILLING_EVENTS_TOPIC, {
            stripeSubscriptionId: event.stripeSubscriptionId,
            cancelledAt: event.cancelledAt,
            endsAt: event.cancellationEffectiveAt,
            reason: event.reason,
            tenantId: event.tenantId,
            userId: event.userId
        });
    }

    @OnEvent('subscription.downgrade-scheduled', { async: true })
    async handleSubscriptionDowngradeScheduled(event: SubscriptionDowngradeScheduledEvent): Promise<void> {
        await this.broadcast('billing', event.eventType, event.tenantId, event.eventId, BILLING_EVENTS_TOPIC, {
            previousPlan: event.previousPlan,
            targetPlan: event.targetPlan,
            effectiveDate: event.effectiveDate,
            tenantId: event.tenantId,
            userId: event.userId
        });
    }

    @OnEvent('subscription.upgraded', { async: true })
    async handleSubscriptionUpgraded(event: SubscriptionUpgradedEvent): Promise<void> {
        await this.broadcast('billing', event.eventType, event.tenantId, event.eventId, BILLING_EVENTS_TOPIC, {
            previousPlan: event.previousPlan,
            newPlan: event.billingPlan,
            effectiveDate: event.effectiveDate,
            tenantId: event.tenantId,
            userId: event.userId
        });
    }

    @OnEvent('trial.reminder', { async: true })
    async handleTrialReminder(event: TrialReminderEvent): Promise<void> {
        await this.broadcast('billing', event.eventType, event.tenantId, event.eventId, BILLING_EVENTS_TOPIC, {
            trialEndsAt: event.trialEndsAt,
            daysRemaining: event.daysRemaining,
            triggeredAt: event.triggeredAt,
            tenantId: event.tenantId,
            userId: event.userId
        });
    }

    @OnEvent('trial.expired', { async: true })
    async handleTrialExpired(event: TrialExpiredEvent): Promise<void> {
        await this.broadcast('billing', event.eventType, event.tenantId, event.eventId, BILLING_EVENTS_TOPIC, {
            trialEndsAt: event.trialEndsAt,
            triggeredAt: event.triggeredAt,
            tenantId: event.tenantId,
            userId: event.userId
        });
    }

    @OnEvent('tenant.payment-status-changed', { async: true })
    async handlePaymentStatusChanged(event: TenantPaymentStatusChangedEvent): Promise<void> {
        const previous = event.previousStatus as PaymentStatusEnum;
        const next = event.nextStatus as PaymentStatusEnum;

        const statusData = {
            previousStatus: event.previousStatus,
            nextStatus: event.nextStatus,
            changedAt: event.changedAt,
            reason: event.reason,
            tenantId: event.tenantId,
            userId: event.userId
        };

        await this.broadcast('billing', event.eventType, event.tenantId, event.eventId, BILLING_EVENTS_TOPIC, statusData);

        if (next === PaymentStatusEnum.PAST_DUE) {
            await this.broadcast('billing', BillingEvents.PAYMENT_FAILED, event.tenantId, event.eventId, BILLING_EVENTS_TOPIC, statusData);
        }

        if (next === PaymentStatusEnum.RESTRICTED) {
            await this.broadcast('billing', BillingEvents.TENANT_RESTRICTED, event.tenantId, event.eventId, BILLING_EVENTS_TOPIC, statusData);
        }

        if (next === PaymentStatusEnum.LOCKED) {
            await this.broadcast('billing', BillingEvents.TENANT_LOCKED, event.tenantId, event.eventId, BILLING_EVENTS_TOPIC, statusData);
        }

        if (next === PaymentStatusEnum.ACTIVE && previous !== PaymentStatusEnum.ACTIVE) {
            await this.broadcast('billing', BillingEvents.PAYMENT_RESTORED, event.tenantId, event.eventId, BILLING_EVENTS_TOPIC, statusData);
            await this.broadcast('billing', BillingEvents.TENANT_RESTORED, event.tenantId, event.eventId, BILLING_EVENTS_TOPIC, statusData);
        }
    }

    // ── Private helper ─────────────────────────────────────────────────

    private async broadcast(
        aggregateType: string,
        eventType: BaseEventType,
        tenantId: string,
        eventId: string,
        topicName: SnsTopicName,
        message: Record<string, unknown>
    ): Promise<void> {
        try {
            await this.sideEffectService.createBroadcastSideEffect(aggregateType, tenantId, eventType, topicName, message, {
                critical: false,
                messageGroupId: tenantId,
                idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(`${aggregateType}-${eventType}-${eventId}`)
            });

            this.logger.debug(`Broadcast ${eventType} to ${topicName}`, { eventId, tenantId });
        } catch (error) {
            this.logger.warn(`Failed to broadcast ${eventType} to ${topicName} (check DLQ)`, {
                eventId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
