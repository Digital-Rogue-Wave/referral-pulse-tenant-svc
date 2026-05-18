import { BaseResponseMapper } from '@common/helper/base-response.mapper';
import type { ReservedSubdomainProps } from '../dns.types';
import { ReservedSubdomainResponse } from '../responses/dns.responses';

/**
 * Mapper for ReservedSubdomain entity to response
 */
export class ReservedSubdomainResponseMapper extends BaseResponseMapper<
    ReservedSubdomainProps,
    ReservedSubdomainResponse
> {
    constructor() {
        super(ReservedSubdomainResponse);
    }
}

export const reservedSubdomainResponseMapper = new ReservedSubdomainResponseMapper();
