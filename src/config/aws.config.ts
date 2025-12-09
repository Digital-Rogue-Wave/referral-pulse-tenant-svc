import { registerAs } from '@nestjs/config';
import validateConfig from '@mod/common/validators/validate-config';
import type { MaybeType } from '@mod/types/maybe.type';
import { IsEnum, IsInt, IsNumberString, IsOptional } from 'class-validator';

export enum AwsRetryMode {
    Standard = 'standard',
    Adaptive = 'adaptive',
    Legacy = 'legacy',
}

export type AwsConfig = {
    /** Global AWS region for SDK clients (IRSA/instance profile supply credentials) */
    region: string;
    /** Global max attempts for SDK retry strategy */
    maxAttempts: number;
    /** Global retry mode (AWS SDK feature flag) */
    retryMode: AwsRetryMode;
};

class AwsEnvValidator {
    @IsOptional()
    AWS_REGION!: MaybeType<string>;

    @IsOptional()
    @IsNumberString()
    AWS_MAX_ATTEMPTS!: MaybeType<number>;

    @IsOptional()
    @IsEnum(AwsRetryMode)
    AWS_RETRY_MODE!: MaybeType<AwsRetryMode>;
}

export default registerAs<AwsConfig>('awsConfig', () => {
    validateConfig(process.env, AwsEnvValidator);

    const region = process.env.AWS_REGION ?? 'us-east-1';
    const maxAttempts = process.env.AWS_MAX_ATTEMPTS ? Number(process.env.AWS_MAX_ATTEMPTS) : 3;
    const retryMode = (process.env.AWS_RETRY_MODE as AwsRetryMode) ?? AwsRetryMode.Standard;

    return { region, maxAttempts, retryMode };
});
