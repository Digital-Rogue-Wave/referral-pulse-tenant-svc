import { Injectable } from '@nestjs/common';
import { createMap, Mapper, MappingProfile, typeConverter } from '@automapper/core';
import { AutomapperProfile, InjectMapper } from '@automapper/nestjs';
import { TenantSettingDto } from '../dto/tenant-setting.dto';
import { TenantSettingEntity } from '../tenant-setting.entity';

@Injectable()
export class TenantSettingSerializationProfile extends AutomapperProfile {
    constructor(@InjectMapper() mapper: Mapper) {
        super(mapper);
    }

    override get profile(): MappingProfile {
        return (mapper) => {
            createMap(
                mapper,
                TenantSettingEntity,
                TenantSettingDto,
                typeConverter(Date, String, (date) => date.toDateString())
            );
        };
    }
}
