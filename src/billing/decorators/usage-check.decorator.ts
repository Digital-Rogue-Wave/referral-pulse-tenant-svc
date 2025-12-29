import { SetMetadata } from '@nestjs/common';

export const USAGE_CHECK_KEY = 'usage_check';

export interface UsageCheckOptions {
    metric: string;
    limit: number;
    amount?: number;
}

export const UsageCheck = (options: UsageCheckOptions) => SetMetadata(USAGE_CHECK_KEY, options);
