import { Injectable } from '@nestjs/common';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { UserNotificationPreferenceEntity } from './user-notification-preference.entity';
import { UpdateUserNotificationPreferenceDto } from './dto/update-user-notification-preference.dto';
import { ClsService } from 'nestjs-cls';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { Utils } from '@mod/common/utils/utils';
import { PublishSnsEventDto, SnsPublishOptionsDto } from '@mod/common/dto/sns-publish.dto';

@Injectable()
export class UserNotificationPreferenceService {
    constructor(
        @InjectTenantAwareRepository(UserNotificationPreferenceEntity)
        private readonly repository: TenantAwareRepository<UserNotificationPreferenceEntity>,
        private readonly cls: ClsService<ClsRequestContext>,
        private readonly sns: SnsPublisher
    ) {}

    async getMyPreferences(): Promise<UserNotificationPreferenceEntity> {
        const userId = this.cls.get().userId;
        const tenantId = this.cls.get().tenantId;

        let pref = await this.repository.findOneTenantContext({ userId });

        if (!pref) {
            pref = this.repository.createTenantContext({
                userId,
                tenantId,
                overrides: {}
            });
            pref = await this.repository.saveTenantContext(pref);
        }

        return pref;
    }

    async updateMyPreferences(updateDto: UpdateUserNotificationPreferenceDto): Promise<UserNotificationPreferenceEntity> {
        const tenantId = this.cls.get().tenantId;

        const pref = await this.getMyPreferences();

        pref.overrides = {
            ...pref.overrides,
            ...updateDto.overrides
        };

        const saved = await this.repository.saveTenantContext(pref);

        // Task 91: Integrate with Integration Service
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: saved.id,
            eventType: 'notification-preference.updated',
            data: {
                userId: saved.userId,
                tenantId: saved.tenantId,
                overrides: saved.overrides
            },
            timestamp: new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'tenant-events',
            groupId: tenantId,
            deduplicationId: `${saved.id}:${new Date().getTime()}` // Ensure unique deduplication ID for updates
        });

        await this.sns.publish(snsEventDto, snsOptionsDto);

        return saved;
    }
}
