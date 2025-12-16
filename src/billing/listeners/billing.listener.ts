import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { Utils } from '@mod/common/utils/utils';
import { PublishSnsEventDto, SnsPublishOptionsDto } from '@mod/common/dto/sns-publish.dto';
import { BillingPlanEnum, SubscriptionStatusEnum } from '@mod/common/enums/tenant.enum';

@Injectable()
export class BillingListener {
    constructor(private readonly sns: SnsPublisher) {}

    @OnEvent('subscription.changed')
    async handleSubscriptionChangedEvent(payload: {
        tenantId: string;
        billingPlan: BillingPlanEnum;
        subscriptionStatus: SubscriptionStatusEnum;
        stripeCustomerId?: string;
        stripeSubscriptionId?: string;
    }) {
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
    }
}
