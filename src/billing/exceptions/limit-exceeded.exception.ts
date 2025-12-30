import { HttpException, HttpStatus } from '@nestjs/common';

export interface LimitExceededDetails {
    metric: string;
    currentUsage: number;
    limit: number;
    upgradeSuggestions?: string[];
    upgradeUrl?: string | null;
}

export class LimitExceededException extends HttpException {
    constructor(details: LimitExceededDetails) {
        super(
            {
                message: 'Plan limit exceeded for this resource.',
                code: 'PLAN_LIMIT_EXCEEDED',
                details
            },
            HttpStatus.PAYMENT_REQUIRED
        );
    }
}
