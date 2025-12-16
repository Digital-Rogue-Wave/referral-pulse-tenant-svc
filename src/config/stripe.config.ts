import { registerAs } from '@nestjs/config';
import { IsOptional, IsString, IsUrl } from 'class-validator';
import validateConfig from '@mod/common/validators/validate-config';
import { MaybeType } from '@mod/types/maybe.type';

export type StripeConfig = {
    secretKey?: MaybeType<string>;
    successUrl?: MaybeType<string>;
    cancelUrl?: MaybeType<string>;
    freePriceId?: MaybeType<string>;
    starterPriceId?: MaybeType<string>;
    growthPriceId?: MaybeType<string>;
    enterprisePriceId?: MaybeType<string>;
    webhookSecret?: MaybeType<string>;
};

class StripeEnvValidator {
    @IsString()
    @IsOptional()
    STRIPE_SECRET_KEY?: MaybeType<string>;

    @IsUrl({ require_tld: false })
    @IsOptional()
    STRIPE_SUCCESS_URL?: MaybeType<string>;

    @IsUrl({ require_tld: false })
    @IsOptional()
    STRIPE_CANCEL_URL?: MaybeType<string>;

    @IsString()
    @IsOptional()
    STRIPE_FREE_PRICE_ID?: MaybeType<string>;

    @IsString()
    @IsOptional()
    STRIPE_STARTER_PRICE_ID?: MaybeType<string>;

    @IsString()
    @IsOptional()
    STRIPE_GROWTH_PRICE_ID?: MaybeType<string>;

    @IsString()
    @IsOptional()
    STRIPE_ENTERPRISE_PRICE_ID?: MaybeType<string>;

    @IsString()
    @IsOptional()
    STRIPE_WEBHOOK_SECRET?: MaybeType<string>;
}

export default registerAs<StripeConfig>('stripeConfig', () => {
    validateConfig(process.env, StripeEnvValidator);

    return {
        secretKey: process.env.STRIPE_SECRET_KEY,
        successUrl: process.env.STRIPE_SUCCESS_URL,
        cancelUrl: process.env.STRIPE_CANCEL_URL,
        freePriceId: process.env.STRIPE_FREE_PRICE_ID,
        starterPriceId: process.env.STRIPE_STARTER_PRICE_ID,
        growthPriceId: process.env.STRIPE_GROWTH_PRICE_ID,
        enterprisePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
    };
});
