import { SetMetadata } from '@nestjs/common';

export const BILLING_GUARD_KEY = 'billing_guard';

export interface BillingGuardOptions {
    metrics?: string[];
    amount?: number;
    gracePercentage?: number;
}

export const BillingGuardConfig = (options: BillingGuardOptions) => SetMetadata(BILLING_GUARD_KEY, options);
