import { Injectable } from '@nestjs/common';

import { createMap, Mapper, MappingProfile } from '@automapper/core';
import { AutomapperProfile, InjectMapper } from '@automapper/nestjs';
import { FileEntity } from '../file.entity';
import { FileDto } from '../dto/file.dto';

@Injectable()
export class FileSerializationProfile extends AutomapperProfile {
    constructor(@InjectMapper() mapper: Mapper) {
        super(mapper);
    }

    override get profile(): MappingProfile {
        return (mapper) => {
            createMap(mapper, FileEntity, FileDto);
        };
    }
}
