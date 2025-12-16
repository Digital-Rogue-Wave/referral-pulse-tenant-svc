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

@Module({
    imports: [TypeOrmModule.forFeature([TenantSettingEntity]), TenantAwareRepositoryModule.forEntities([TenantSettingEntity]), CurrencyModule],
    controllers: [AwareTenantSettingController, AgnosticTenantSettingController],
    providers: [AwareTenantSettingService, AgnosticTenantSettingService, TenantSettingSerializationProfile],
    exports: [AwareTenantSettingService, AgnosticTenantSettingService]
})
export class TenantSettingModule {}
