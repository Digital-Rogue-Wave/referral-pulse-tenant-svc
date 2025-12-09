import { registerAs } from '@nestjs/config';
import validateConfig from '@mod/common/validators/validate-config';
import type { MaybeType } from '@mod/types/maybe.type';
import { IsBooleanString, IsEnum, IsInt, IsNumberString, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export enum S3SseMode {
    None = 'none',
    AES256 = 'AES256',
    Kms = 'aws:kms',
}

export type S3Config = {
    bucket: string;

    /** Optional S3-compatible endpoint (MinIO, etc.) */
    endpoint?: string;
    forcePathStyle: boolean;
    accelerate: boolean;

    /** Service-level prefix; tenantId is appended at runtime */
    keyPrefix?: string;

    /** Server-side encryption defaults */
    sse: S3SseMode;
    kmsKeyId?: string;

    /** Presign defaults (seconds) */
    presignExpiresSeconds: number;
};

class S3EnvValidator {
    @IsString()
    S3_BUCKET!: string;

    @IsUrl({ require_tld: false })
    @IsOptional()
    S3_ENDPOINT!: MaybeType<string>;

    @IsBooleanString()
    @IsOptional()
    S3_FORCE_PATH_STYLE!: MaybeType<string>;

    @IsBooleanString()
    @IsOptional()
    S3_ACCELERATE!: MaybeType<string>;

    @IsString()
    @IsOptional()
    S3_KEY_PREFIX!: MaybeType<string>;

    @IsEnum(S3SseMode)
    @IsOptional()
    S3_SSE!: MaybeType<S3SseMode>;

    @IsString()
    @IsOptional()
    S3_KMS_KEY_ID!: MaybeType<string>;

    @IsNumberString()
    @IsOptional()
    S3_PRESIGN_EXPIRES_SEC!: MaybeType<number>;
}

export default registerAs<S3Config>('s3Config', () => {
    validateConfig(process.env, S3EnvValidator);

    return {
        bucket: process.env.S3_BUCKET as string,
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'false') === 'true',
        accelerate: (process.env.S3_ACCELERATE ?? 'false') === 'true',
        keyPrefix: process.env.S3_KEY_PREFIX || undefined,
        sse: (process.env.S3_SSE as S3SseMode) ?? S3SseMode.None,
        kmsKeyId: process.env.S3_KMS_KEY_ID || undefined,
        presignExpiresSeconds: process.env.S3_PRESIGN_EXPIRES_SEC ? Number(process.env.S3_PRESIGN_EXPIRES_SEC) : 900,
    };
});
