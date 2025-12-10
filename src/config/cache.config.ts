import { registerAs } from '@nestjs/config';
import validateConfig from '@mod/common/validators/validate-config';
import { IsInt, IsOptional, IsUrl, Min } from 'class-validator';

export type CacheConfig = {
    httpBreaker: {
        cacheMax: number;
        cacheTtlMs: number;
        cacheMaxBytes: number;
    };
    tokenBroker: {
        baseURL: string;
        timeoutMs: number;
        cacheMax: number;
        cacheMaxBytes: number;
    };
};

class EnvValidator {
    @IsInt() @Min(1) @IsOptional() HTTP_CB_CACHE_MAX?: number;
    @IsInt() @Min(1000) @IsOptional() HTTP_CB_CACHE_TTL_MS?: number;
    @IsInt() @Min(1024) @IsOptional() HTTP_CB_CACHE_MAX_BYTES?: number;

    @IsUrl({ require_tld: false }) TOKEN_BROKER_BASE_URL!: string;
    @IsInt() @Min(100) TOKEN_BROKER_TIMEOUT_MS!: number;

    @IsInt() @Min(1) @IsOptional() TOKEN_BROKER_CACHE_MAX?: number;
    @IsInt() @Min(1024) @IsOptional() TOKEN_BROKER_CACHE_MAX_BYTES?: number;
}

export default registerAs<CacheConfig>('cacheConfig', () => {
    validateConfig(process.env, EnvValidator);

    return {
        httpBreaker: {
            cacheMax: process.env.HTTP_CB_CACHE_MAX ? parseInt(process.env.HTTP_CB_CACHE_MAX, 10) : 128,
            cacheTtlMs: process.env.HTTP_CB_CACHE_TTL_MS ? parseInt(process.env.HTTP_CB_CACHE_TTL_MS, 10) : 300_000,
            cacheMaxBytes: process.env.HTTP_CB_CACHE_MAX_BYTES ? parseInt(process.env.HTTP_CB_CACHE_MAX_BYTES, 10) : 8 * 1024 * 1024
        },
        tokenBroker: {
            baseURL: process.env.TOKEN_BROKER_BASE_URL as string,
            timeoutMs: parseInt(process.env.TOKEN_BROKER_TIMEOUT_MS as string, 10),
            cacheMax: process.env.TOKEN_BROKER_CACHE_MAX ? parseInt(process.env.TOKEN_BROKER_CACHE_MAX, 10) : 2000,
            cacheMaxBytes: process.env.TOKEN_BROKER_CACHE_MAX_BYTES ? parseInt(process.env.TOKEN_BROKER_CACHE_MAX_BYTES, 10) : 4 * 1024 * 1024
        }
    };
});
