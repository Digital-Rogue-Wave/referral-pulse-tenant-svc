import { BaseResponseMapper } from '@common/helper/base-response.mapper';
import type { TenantProps, TenantProfileProps } from '../tenant.types';
import { TenantResponse, TenantProfileResponse } from '../responses/tenant.responses';

/**
 * Mapper for Tenant entity to response
 */
export class TenantResponseMapper extends BaseResponseMapper<TenantProps, TenantResponse> {
    constructor() {
        super(TenantResponse);
    }

    /**
     * Map tenant with profile stats to TenantProfileResponse
     */
    toProfileResponse(props: TenantProfileProps): TenantProfileResponse {
        const response = new TenantProfileResponse();
        Object.assign(response, this.toResponse(props));
        response.memberCount = props.memberCount;
        response.pendingInvitationCount = props.pendingInvitationCount;
        response.activeApiKeyCount = props.activeApiKeyCount;
        return response;
    }
}

export const tenantResponseMapper = new TenantResponseMapper();
