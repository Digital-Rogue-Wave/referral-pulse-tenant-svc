import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Utils } from '@mod/common/utils/utils';
import { PublishSnsEventDto, SnsPublishOptionsDto } from '@mod/common/dto/sns-publish.dto';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';

@Injectable()
export class TenantSettingListener {
    constructor(private readonly sns: SnsPublisher) {}

    @OnEvent('user-notification-preference.updated')
    async handleUserNotificationPreferenceUpdatedEvent(payload: any) {
        const { id, userId, tenantId, overrides } = payload;

        // Task 91: Integrate with Integration Service
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: id,
            eventType: 'notification-preference.updated',
            data: {
                userId,
                tenantId,
                overrides
            },
            timestamp: new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'tenant-events',
            groupId: tenantId,
            deduplicationId: `${id}:${new Date().getTime()}` // Ensure unique deduplication ID for updates
        });

        await this.sns.publish(snsEventDto, snsOptionsDto);
    }
}
