import { BaseResponseMapper } from '@common/helper/base-response.mapper';
import type { TeamMemberProps } from '../team-member.types';
import { TeamMemberResponse } from '../responses/team-member.responses';

/**
 * Mapper for TeamMember entity to response
 */
class TeamMemberResponseMapper extends BaseResponseMapper<TeamMemberProps, TeamMemberResponse> {
    constructor() {
        super(TeamMemberResponse);
    }

    toResponse(entity: TeamMemberProps): TeamMemberResponse {
        const response = new TeamMemberResponse();
        response.id = entity.id;
        response.userId = entity.userId;
        response.tenantId = entity.tenantId;
        response.role = entity.role;
        response.status = entity.status;
        response.createdAt = entity.createdAt;
        response.updatedAt = entity.updatedAt;
        return response;
    }
}

export const teamMemberResponseMapper = new TeamMemberResponseMapper();
