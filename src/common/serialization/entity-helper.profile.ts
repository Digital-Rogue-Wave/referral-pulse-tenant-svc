import { Injectable } from '@nestjs/common';
import EntityHelper from '../entities/entity-helper';
import { AutomapperProfile, InjectMapper } from '@automapper/nestjs';
import { createMap, Mapper, MappingProfile } from '@automapper/core';
import { EntityHelperDto } from '../dto/entity-helper.dto';

@Injectable()
export class EntityHelperProfile extends AutomapperProfile {
    constructor(@InjectMapper() mapper: Mapper) {
        super(mapper);
    }

    override get profile(): MappingProfile {
        return (mapper) => {
            createMap(mapper, EntityHelper, EntityHelperDto);
        };
    }
}
