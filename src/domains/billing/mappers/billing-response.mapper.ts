import { BaseResponseMapper } from '@common/helper/base-response.mapper';

import type { PlanProps, BillingProps, TenantUsageProps } from '../billing.types';
import { PlanResponse, BillingResponse, TenantUsageResponse } from '../responses/billing.responses';

export class PlanResponseMapper extends BaseResponseMapper<PlanProps, PlanResponse> {
    constructor() {
        super(PlanResponse);
    }
}

export class BillingResponseMapper extends BaseResponseMapper<BillingProps, BillingResponse> {
    constructor() {
        super(BillingResponse);
    }
}

export class TenantUsageResponseMapper extends BaseResponseMapper<TenantUsageProps, TenantUsageResponse> {
    constructor() {
        super(TenantUsageResponse);
    }
}

export const planResponseMapper = new PlanResponseMapper();
export const billingResponseMapper = new BillingResponseMapper();
export const tenantUsageResponseMapper = new TenantUsageResponseMapper();