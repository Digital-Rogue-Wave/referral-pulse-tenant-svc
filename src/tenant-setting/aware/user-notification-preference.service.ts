import { Injectable } from '@nestjs/common';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { UserNotificationPreferenceEntity } from '../user-notification-preference.entity';
import { UpdateUserNotificationPreferenceDto } from '../dto/update-user-notification-preference.dto';
import { CurrentUserType } from '@mod/common/auth/current-user.decorator';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class UserNotificationPreferenceService {
    constructor(
        @InjectTenantAwareRepository(UserNotificationPreferenceEntity)
        private readonly repository: TenantAwareRepository<UserNotificationPreferenceEntity>,
        private readonly eventEmitter: EventEmitter2
    ) {}

    async getMyPreferences(user: CurrentUserType): Promise<UserNotificationPreferenceEntity> {
        const tenantId = this.repository.getTenantId();

        let pref = await this.repository.findOneTenantContext({ userId: user.id });

        if (!pref) {
            pref = this.repository.createTenantContext({
                userId: user.id,
                tenantId,
                overrides: {}
            });
            pref = await this.repository.saveTenantContext(pref);
        }

        return pref;
    }

    async updateMyPreferences(user: CurrentUserType, updateDto: UpdateUserNotificationPreferenceDto): Promise<UserNotificationPreferenceEntity> {
        const tenantId = this.repository.getTenantId();

        const pref = await this.getMyPreferences(user);

        pref.overrides = {
            ...pref.overrides,
            ...updateDto.overrides
        };

        const saved = await this.repository.saveTenantContext(pref);

        this.eventEmitter.emit('user-notification-preference.updated', {
            id: saved.id,
            userId: user.id,
            tenantId,
            overrides: saved.overrides
        });

        return saved;
    }
}
