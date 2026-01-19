import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { Utils } from '@mod/common/utils/utils';
import { PublishSnsEventDto, SnsPublishOptionsDto } from '@mod/common/dto/sns-publish.dto';
import { MonitoringService } from '@mod/common/monitoring/monitoring.service';
import { PaymentStatusEnum } from '@mod/common/enums/billing.enum';
import { randomUUID } from 'node:crypto';
import {
    SubscriptionChangedEvent,
    SubscriptionCreatedEvent,
    SubscriptionDowngradeScheduledEvent,
    SubscriptionUpgradedEvent,
    SubscriptionCancelledEvent,
    TenantPaymentStatusChangedEvent,
    TrialExpiredEvent,
    TrialReminderEvent
} from '@mod/common/interfaces/billing-events.interface';

@Injectable()
export class BillingListener {
    constructor(
        private readonly sns: SnsPublisher,
        private readonly metrics: MonitoringService
    ) {}

    private buildDeduplicationId(tenantId: string, eventType: string, payload: any): string {
        const parts: string[] = [tenantId, eventType];
        const add = (v: unknown) => {
            if (typeof v === 'string' && v.length > 0) {
                parts.push(v);
            } else if (typeof v === 'number' && Number.isFinite(v)) {
                parts.push(String(v));
            }
        };

        add(payload?.stripeEventId);
        add(payload?.stripeInvoiceId);
        add(payload?.stripeSubscriptionId);
        add(payload?.stripeCustomerId);
        add(payload?.billingPlan);
        add(payload?.subscriptionStatus);
        add(payload?.previousPlan);
        add(payload?.effectiveDate);
        add(payload?.trialEndsAt);
        add(payload?.daysRemaining);
        add(payload?.month);
        add(payload?.periodDate);
        add(payload?.metric);
        add(payload?.threshold);

        return parts.join(':').slice(0, 128);
    }

    @OnEvent('subscription.changed')
    async handleSubscriptionChangedEvent(payload: SubscriptionChangedEvent) {
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: randomUUID(),
            tenantId: payload.tenantId,
            eventType: 'subscription.changed',
            data: payload as any,
            timestamp: new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'referral-platform-events',
            groupId: payload.tenantId,
            deduplicationId: this.buildDeduplicationId(payload.tenantId, 'subscription.changed', payload)
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto);

        this.metrics.incCounter('billing_subscription_events_total', { event: 'subscription.changed', result: 'ok' });
    }

    @OnEvent('subscription.created')
    async handleSubscriptionCreatedEvent(payload: SubscriptionCreatedEvent) {
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: randomUUID(),
            tenantId: payload.tenantId,
            eventType: 'subscription.created',
            data: payload as any,
            timestamp: new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'referral-platform-events',
            groupId: payload.tenantId,
            deduplicationId: this.buildDeduplicationId(payload.tenantId, 'subscription.created', payload)
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto);

        this.metrics.incCounter('billing_subscription_events_total', { event: 'subscription.created', result: 'ok' });
    }

    @OnEvent('subscription.cancelled')
    async handleSubscriptionCancelledEvent(payload: SubscriptionCancelledEvent) {
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: randomUUID(),
            tenantId: payload.tenantId,
            eventType: 'subscription.cancelled',
            data: payload as any,
            timestamp: new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'referral-platform-events',
            groupId: payload.tenantId,
            deduplicationId: this.buildDeduplicationId(payload.tenantId, 'subscription.cancelled', payload)
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto);

        this.metrics.incCounter('billing_subscription_events_total', {
            event: 'subscription.cancelled',
            result: 'ok'
        });
    }

    @OnEvent('subscription.downgrade_scheduled')
    async handleSubscriptionDowngradeScheduledEvent(payload: SubscriptionDowngradeScheduledEvent) {
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: randomUUID(),
            tenantId: payload.tenantId,
            eventType: 'subscription.downgrade_scheduled',
            data: payload as any,
            timestamp: new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'referral-platform-events',
            groupId: payload.tenantId,
            deduplicationId: this.buildDeduplicationId(payload.tenantId, 'subscription.downgrade_scheduled', payload)
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto);

        this.metrics.incCounter('billing_subscription_events_total', {
            event: 'subscription.downgrade_scheduled',
            result: 'ok'
        });
    }

    @OnEvent('subscription.upgraded')
    async handleSubscriptionUpgradedEvent(payload: SubscriptionUpgradedEvent) {
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: randomUUID(),
            tenantId: payload.tenantId,
            eventType: 'subscription.upgraded',
            data: payload as any,
            timestamp: new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'referral-platform-events',
            groupId: payload.tenantId,
            deduplicationId: this.buildDeduplicationId(payload.tenantId, 'subscription.upgraded', payload)
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto);

        this.metrics.incCounter('billing_subscription_events_total', { event: 'subscription.upgraded', result: 'ok' });
    }

    @OnEvent('tenant.payment_status.changed')
    async handleTenantPaymentStatusChangedEvent(payload: TenantPaymentStatusChangedEvent) {
        const previous = payload.previousStatus as PaymentStatusEnum;
        const next = payload.nextStatus as PaymentStatusEnum;

        const publishEvents: string[] = [];

        if (next === PaymentStatusEnum.PAST_DUE) {
            publishEvents.push('payment.failed');
        }

        if (next === PaymentStatusEnum.RESTRICTED) {
            publishEvents.push('tenant.restricted');
        }

        if (next === PaymentStatusEnum.LOCKED) {
            publishEvents.push('tenant.locked');
        }

        if (next === PaymentStatusEnum.ACTIVE && previous !== PaymentStatusEnum.ACTIVE) {
            publishEvents.push('payment.restored');
            publishEvents.push('tenant.restored');
        }

        for (const eventType of publishEvents) {
            const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
                eventId: randomUUID(),
                tenantId: payload.tenantId,
                eventType,
                data: payload as any,
                timestamp: payload.changedAt
            });

            const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
                topic: 'referral-platform-events',
                groupId: payload.tenantId,
                deduplicationId: this.buildDeduplicationId(payload.tenantId, eventType, payload)
            });

            await this.sns.publish(snsEventDto as any, snsOptionsDto as any);

            this.metrics.incCounter('billing_subscription_events_total', {
                event: eventType,
                result: 'ok'
            });
        }
    }

    @OnEvent('usage.threshold_crossed')
    async handleUsageThresholdCrossedEvent(payload: any) {
        const tenantId = payload?.tenantId as string | undefined;
        if (!tenantId) {
            return;
        }

        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: randomUUID(),
            tenantId,
            eventType: 'usage.threshold_crossed',
            data: payload as any,
            timestamp: payload.triggeredAt ?? new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'referral-platform-events',
            groupId: tenantId,
            deduplicationId: this.buildDeduplicationId(tenantId, 'usage.threshold_crossed', payload)
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto as any);
        this.metrics.incCounter('billing_subscription_events_total', { event: 'usage.threshold_crossed', result: 'ok' });
    }

    @OnEvent('usage.monthly_summary')
    async handleUsageMonthlySummaryEvent(payload: any) {
        const tenantId = payload?.tenantId as string | undefined;
        if (!tenantId) {
            return;
        }

        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: randomUUID(),
            tenantId,
            eventType: 'usage.monthly_summary',
            data: payload as any,
            timestamp: payload.triggeredAt ?? new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'referral-platform-events',
            groupId: tenantId,
            deduplicationId: this.buildDeduplicationId(tenantId, 'usage.monthly_summary', payload)
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto as any);
        this.metrics.incCounter('billing_subscription_events_total', { event: 'usage.monthly_summary', result: 'ok' });
    }

    @OnEvent('trial.reminder')
    async handleTrialReminderEvent(payload: TrialReminderEvent) {
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: randomUUID(),
            tenantId: payload.tenantId,
            eventType: 'trial.reminder',
            data: payload as any,
            timestamp: payload.triggeredAt
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'referral-platform-events',
            groupId: payload.tenantId,
            deduplicationId: this.buildDeduplicationId(payload.tenantId, 'trial.reminder', payload)
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto as any);
        this.metrics.incCounter('billing_subscription_events_total', { event: 'trial.reminder', result: 'ok' });
    }

    @OnEvent('trial.expired')
    async handleTrialExpiredEvent(payload: TrialExpiredEvent) {
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: randomUUID(),
            tenantId: payload.tenantId,
            eventType: 'trial.expired',
            data: payload as any,
            timestamp: payload.triggeredAt
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'referral-platform-events',
            groupId: payload.tenantId,
            deduplicationId: this.buildDeduplicationId(payload.tenantId, 'trial.expired', payload)
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto as any);
        this.metrics.incCounter('billing_subscription_events_total', { event: 'trial.expired', result: 'ok' });
    }
}
