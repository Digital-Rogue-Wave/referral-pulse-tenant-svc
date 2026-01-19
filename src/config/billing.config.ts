import { registerAs } from '@nestjs/config';
import { IsBooleanString, IsOptional, IsString } from 'class-validator';
import validateConfig from '@mod/common/validators/validate-config';
import { MaybeType } from '@mod/types/maybe.type';

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
