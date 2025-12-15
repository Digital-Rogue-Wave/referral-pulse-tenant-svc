import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantSettingService } from './tenant-setting.service';
import { TenantSettingController } from './tenant-setting.controller';
import { TenantSettingEntity } from './tenant-setting.entity';
import { CurrencyModule } from '@mod/currency/currency.module';
import { TenantSettingSerializationProfile } from './serialization/tenant-setting-serialization.profile';

@Module({
    imports: [TypeOrmModule.forFeature([TenantSettingEntity]), CurrencyModule],
    controllers: [TenantSettingController],
    providers: [TenantSettingService, TenantSettingSerializationProfile],
    exports: [TenantSettingService]
})
export class TenantSettingModule {}
