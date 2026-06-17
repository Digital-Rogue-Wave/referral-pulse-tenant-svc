import { registerAs } from '@nestjs/config';
import { IsBooleanString, IsOptional, IsString } from 'class-validator';
import validateConfig from '@common/validators/validate-config';
import { MaybeType } from '@app/types';

export type BillingConfig = {
    planStripeSyncEnabled: boolean;
    planStripeSyncCron: string;
};

class BillingEnvValidator {
    @IsBooleanString()
    @IsOptional()
    BILLING_PLAN_STRIPE_SYNC_ENABLED?: MaybeType<string>;

    @IsString()
    @IsOptional()
    BILLING_PLAN_STRIPE_SYNC_CRON?: MaybeType<string>;
}

export default registerAs<BillingConfig>('billingConfig', () => {
    validateConfig(process.env, BillingEnvValidator);

    return {
        planStripeSyncEnabled: (process.env.BILLING_PLAN_STRIPE_SYNC_ENABLED ?? 'false') === 'true',
        planStripeSyncCron: process.env.BILLING_PLAN_STRIPE_SYNC_CRON ?? '0 * * * *'
    };
});
