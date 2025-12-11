import { Injectable } from '@nestjs/common';
import { createMap, Mapper, MappingProfile, typeConverter } from '@automapper/core';
import { AutomapperProfile, InjectMapper } from '@automapper/nestjs';
import { InvitationDto } from '../dto/invitation.dto';
import { InvitationEntity } from '../invitation.entity';

@Injectable()
export class InvitationSerializationProfile extends AutomapperProfile {
    constructor(@InjectMapper() mapper: Mapper) {
        super(mapper);
    }

    override get profile(): MappingProfile {
        return (mapper) => {
            createMap(
                mapper,
                InvitationEntity,
                InvitationDto,
                typeConverter(Date, String, (date) => date.toDateString())
            );
        };
    }
}
