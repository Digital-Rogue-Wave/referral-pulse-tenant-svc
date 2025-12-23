import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantSettingEntity } from './tenant-setting.entity';
import { CurrencyModule } from '@mod/currency/currency.module';
import { TenantSettingSerializationProfile } from './serialization/tenant-setting-serialization.profile';
import { AgnosticTenantSettingController } from './agnostic/agnostic-tenant-setting.controller';
import { AwareTenantSettingController } from './aware/aware-tenant-setting.controller';
import { AgnosticTenantSettingService } from './agnostic/agnostic-tenant-setting.service';
import { AwareTenantSettingService } from './aware/aware-tenant-setting.service';
import { TenantAwareRepositoryModule } from '@mod/common/tenant/tenant-aware.repository';
import { UserNotificationPreferenceEntity } from './user-notification-preference.entity';
import { UserNotificationPreferenceService } from './user-notification-preference.service';
import { UserNotificationPreferenceController } from './user-notification-preference.controller';
import { SnsModule } from '@mod/common/aws-sqs/sns.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([TenantSettingEntity, UserNotificationPreferenceEntity]),
        TenantAwareRepositoryModule.forEntities([TenantSettingEntity, UserNotificationPreferenceEntity]),
        CurrencyModule,
        SnsModule
    ],
    controllers: [AwareTenantSettingController, AgnosticTenantSettingController, UserNotificationPreferenceController],
    providers: [AwareTenantSettingService, AgnosticTenantSettingService, TenantSettingSerializationProfile, UserNotificationPreferenceService],
    exports: [AwareTenantSettingService, AgnosticTenantSettingService, UserNotificationPreferenceService]
})
export class TenantSettingModule {}
