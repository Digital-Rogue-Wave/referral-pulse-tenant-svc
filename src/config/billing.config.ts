import { registerAs } from '@nestjs/config';
import { IsBooleanString, IsNumberString, IsOptional, IsString } from 'class-validator';
import validateConfig from '@common/validators/validate-config';
import { MaybeType } from '@app/types';

export type BillingConfig = {
    planStripeSyncEnabled: boolean;
    planStripeSyncCron: string;
    /** Dunning: days a tenant stays `past_due` before it is `restricted`. */
    dunningRestrictAfterDays: number;
    /** Dunning: days a tenant stays `restricted` before it is `locked`. */
    dunningLockAfterDays: number;
};

class BillingEnvValidator {
    @IsBooleanString()
    @IsOptional()
    BILLING_PLAN_STRIPE_SYNC_ENABLED?: MaybeType<string>;

    @IsString()
    @IsOptional()
    BILLING_PLAN_STRIPE_SYNC_CRON?: MaybeType<string>;

    @IsNumberString()
    @IsOptional()
    BILLING_DUNNING_RESTRICT_AFTER_DAYS?: MaybeType<string>;

    @IsNumberString()
    @IsOptional()
    BILLING_DUNNING_LOCK_AFTER_DAYS?: MaybeType<string>;
}

export default registerAs<BillingConfig>('billingConfig', () => {
    validateConfig(process.env, BillingEnvValidator);

    return {
        planStripeSyncEnabled: (process.env.BILLING_PLAN_STRIPE_SYNC_ENABLED ?? 'false') === 'true',
        planStripeSyncCron: process.env.BILLING_PLAN_STRIPE_SYNC_CRON ?? '0 * * * *',
        dunningRestrictAfterDays: Number(process.env.BILLING_DUNNING_RESTRICT_AFTER_DAYS ?? 7),
        dunningLockAfterDays: Number(process.env.BILLING_DUNNING_LOCK_AFTER_DAYS ?? 14)
    };
});
