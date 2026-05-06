import { BaseResponseMapper } from '@common/helper/base-response.mapper';
import type { BillingProps } from '../billing.types';
import { SubscriptionStatusDto } from '../dto/subscription-status.dto';

export class BillingResponseMapper extends BaseResponseMapper<BillingProps, SubscriptionStatusDto> {
    constructor() {
        super(SubscriptionStatusDto);
    }
}

export const billingResponseMapper = new BillingResponseMapper();
