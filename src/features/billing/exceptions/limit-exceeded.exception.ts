import { HttpStatus } from '@nestjs/common';

import { BaseException } from '@common/exceptions/base.exceptions';
import { ErrorCode } from '@app/types/app.type';

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
            'PLAN_LIMIT_EXCEEDED' as ErrorCode,
            'Plan limit exceeded for this resource.',
            HttpStatus.PAYMENT_REQUIRED,
            details as unknown as Record<string, unknown>,
        );
    }
}
