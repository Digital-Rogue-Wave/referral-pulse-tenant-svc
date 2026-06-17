import { Module } from '@nestjs/common';

import { TenantSettingService } from './tenant-setting.service';
import { TenantSettingController } from './tenant-setting.controller';
import { UserNotificationPreferenceService } from './user-notification-preference.service';
import { UserNotificationPreferenceController } from './user-notification-preference.controller';

@Module({
    controllers: [TenantSettingController, UserNotificationPreferenceController],
    providers: [TenantSettingService, UserNotificationPreferenceService],
    exports: [TenantSettingService, UserNotificationPreferenceService]
})
export class TenantSettingModule {}
