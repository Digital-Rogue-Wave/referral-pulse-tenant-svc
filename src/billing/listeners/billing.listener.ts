import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { Utils } from '@mod/common/utils/utils';
import { PublishSnsEventDto, SnsPublishOptionsDto } from '@mod/common/dto/sns-publish.dto';
import { MonitoringService } from '@mod/common/monitoring/monitoring.service';
import { SesService } from '@mod/common/aws-ses/ses.service';
import { KratosService } from '@mod/common/auth/kratos.service';
import { SubscriptionChangedEvent, SubscriptionCreatedEvent, SubscriptionUpgradedEvent } from '@mod/common/interfaces/billing-events.interface';

@Injectable()
export class BillingListener {
    constructor(
        private readonly sns: SnsPublisher,
        private readonly metrics: MonitoringService,
        private readonly sesService: SesService,
        private readonly kratosService: KratosService
    ) {}

    @OnEvent('subscription.changed')
    async handleSubscriptionChangedEvent(payload: SubscriptionChangedEvent) {
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: payload.tenantId,
            eventType: 'subscription.changed',
            data: payload as any,
            timestamp: new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'tenant-events',
            groupId: payload.tenantId,
            deduplicationId: `${payload.tenantId}-subscription-changed-${Date.now()}`
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto);

        this.metrics.incCounter('billing_subscription_events_total', { event: 'subscription.changed', result: 'ok' });
    }

    @OnEvent('subscription.created')
    async handleSubscriptionCreatedEvent(payload: SubscriptionCreatedEvent) {
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: payload.tenantId,
            eventType: 'subscription.created',
            data: payload as any,
            timestamp: new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'tenant-events',
            groupId: payload.tenantId,
            deduplicationId: `${payload.tenantId}-subscription-created-${Date.now()}`
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto);

        this.metrics.incCounter('billing_subscription_events_total', { event: 'subscription.created', result: 'ok' });

        if (payload.checkoutUserId) {
            try {
                const identity = await this.kratosService.getIdentity(payload.checkoutUserId);
                const email = (identity as any)?.traits?.email as string | undefined;

                if (email) {
                    const subject = 'Subscription Confirmed';
                    const body = `Your subscription for plan ${payload.billingPlan} is now active.`;
                    await this.sesService.sendEmail(email, subject, body);
                }
            } catch {
            }
        }
    }

    @OnEvent('subscription.upgraded')
    async handleSubscriptionUpgradedEvent(payload: SubscriptionUpgradedEvent) {
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: payload.tenantId,
            eventType: 'subscription.upgraded',
            data: payload as any,
            timestamp: new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'tenant-events',
            groupId: payload.tenantId,
            deduplicationId: `${payload.tenantId}-subscription-upgraded-${Date.now()}`
        });

        await this.sns.publish(snsEventDto as any, snsOptionsDto);

        this.metrics.incCounter('billing_subscription_events_total', { event: 'subscription.upgraded', result: 'ok' });

        if (payload.upgradeUserId) {
            try {
                const identity = await this.kratosService.getIdentity(payload.upgradeUserId);
                const email = (identity as any)?.traits?.email as string | undefined;

                if (email) {
                    const subject = 'Subscription Upgraded';
                    const body = `Your subscription has been upgraded from plan ${payload.previousPlan} to ${payload.billingPlan}.`;
                    await this.sesService.sendEmail(email, subject, body);
                }
            } catch {
            }
        }
    }
}
