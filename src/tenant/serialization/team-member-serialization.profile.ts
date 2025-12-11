import { AutomapperProfile, InjectMapper } from '@automapper/nestjs';
import { createMap, Mapper } from '@automapper/core';
import { Injectable } from '@nestjs/common';
import { TeamMemberEntity } from '../team-member.entity';
import { TeamMemberDto } from '../dto/team-member.dto';

@Injectable()
export class TeamMemberSerializationProfile extends AutomapperProfile {
    constructor(@InjectMapper() mapper: Mapper) {
        super(mapper);
    }

    override get profile() {
        return (mapper: Mapper) => {
            createMap(mapper, TeamMemberEntity, TeamMemberDto);
        };
    }
}
