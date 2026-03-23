import { BaseResponseMapper } from '@common/helper/base-response.mapper';
import { ApiKeyProps } from '../api-key.types';
import { ApiKeyResponse, ApiKeyWithRawKeyResponse } from '../responses/api-key.responses';

class ApiKeyResponseMapper extends BaseResponseMapper<ApiKeyProps, ApiKeyResponse> {
    constructor() {
        super(ApiKeyResponse);
    }

    /**
     * Map to response with raw key (only for creation)
     */
    toResponseWithRawKey(entity: ApiKeyProps, rawKey: string): ApiKeyWithRawKeyResponse {
        const response = this.toResponse(entity) as ApiKeyWithRawKeyResponse;
        response.rawKey = rawKey;
        return response;
    }
}

export const apiKeyResponseMapper = new ApiKeyResponseMapper();
