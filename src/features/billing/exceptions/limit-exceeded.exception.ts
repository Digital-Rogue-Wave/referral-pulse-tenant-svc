import { HttpStatus } from '@nestjs/common';

import { BaseException } from '@common/exceptions/base.exceptions';

export interface LimitExceededDetails {
    metric: string;
    currentUsage: number;
    limit: number;
    requestedAmount?: number;
    remaining?: number;
    effectiveLimit?: number;
    upgradeSuggestions?: string[];
    upgradeUrl?: string | null;
}

export class LimitExceededException extends BaseException {
    constructor(details: LimitExceededDetails) {
        super(
            'plan_limit_exceeded',
            'Plan limit exceeded for this resource.',
            HttpStatus.PAYMENT_REQUIRED,
            undefined,
            details as unknown as Record<string, unknown>
        );
    }
}
