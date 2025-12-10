import { Injectable } from '@nestjs/common';
import { createMap, Mapper, MappingProfile, typeConverter } from '@automapper/core';
import { AutomapperProfile, InjectMapper } from '@automapper/nestjs';
import { TenantEntity } from '../tenant.entity';
import { TenantDto } from '../dto/tenant.dto';

@Injectable()
export class TenantSerializationProfile extends AutomapperProfile {
    constructor(@InjectMapper() mapper: Mapper) {
        super(mapper);
    }

    override get profile(): MappingProfile {
        return (mapper) => {
            createMap(
                mapper,
                TenantEntity,
                TenantDto,
                typeConverter(Date, String, (date) => date.toDateString())
            );
        };
    }
}
