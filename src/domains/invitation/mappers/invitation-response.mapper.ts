import { BaseResponseMapper } from '@common/helper/base-response.mapper';
import type { InvitationProps } from '../invitation.types';
import { InvitationResponse, InvitationWithTokenResponse } from '../responses/invitation.responses';

/**
 * Mapper for Invitation entity to response
 */
class InvitationResponseMapper extends BaseResponseMapper<InvitationProps, InvitationResponse> {
    constructor() {
        super(InvitationResponse);
    }

    toResponse(entity: InvitationProps): InvitationResponse {
        const response = new InvitationResponse();
        response.id = entity.id;
        response.tenantId = entity.tenantId;
        response.email = entity.email;
        response.role = entity.role;
        response.status = entity.status;
        response.expiresAt = entity.expiresAt;
        response.createdAt = entity.createdAt;
        response.updatedAt = entity.updatedAt;
        return response;
    }

    toResponseWithToken(entity: InvitationProps): InvitationWithTokenResponse {
        const response = new InvitationWithTokenResponse();
        response.id = entity.id;
        response.tenantId = entity.tenantId;
        response.email = entity.email;
        response.role = entity.role;
        response.status = entity.status;
        response.token = entity.token;
        response.expiresAt = entity.expiresAt;
        response.createdAt = entity.createdAt;
        response.updatedAt = entity.updatedAt;
        return response;
    }
}

export const invitationResponseMapper = new InvitationResponseMapper();
