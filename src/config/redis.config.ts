import { registerAs } from '@nestjs/config';
import validateConfig from '@mod/common/validators/validate-config';
import {
    IsBooleanString,
    IsEnum,
    IsIn,
    IsNumberString,
    IsOptional,
    IsString,
    Matches,
    ValidateIf,
} from 'class-validator';
import type { MaybeType } from '@mod/types/maybe.type';

export enum RedisMode {
    Standalone = 'standalone',
    Cluster = 'cluster',
}

export type RedisNode = { host: string; port: number };

export type RedisConfig = {
    mode: RedisMode;
    nodes: RedisNode[];                // endpoints
    username?: string;
    password?: string;
    db?: number;
    keyPrefix?: string;

    // TLS (ElastiCache in-transit encryption)
    tls: boolean;
    tlsServerName?: string;

    // connection / resilience
    maxRetriesPerRequest: number;
    reconnectBackoffMs: number;
    connectionTimeoutMs: number;
    enableAutoPipelining: boolean;
    lazyConnect: boolean;

    // pub/sub
    subscriber: { create: boolean };

    // auth strategy
    authMode: 'none' | 'acl' | 'iam';
};

class RedisEnvValidator {
    @IsEnum(RedisMode) @IsOptional()
    REDIS_MODE?: MaybeType<RedisMode>;

    /**
     * Validate REDIS_NODES only when present.
     * Accepts whitespace around commas: "host:port, host2:port2"
     */
    @ValidateIf(env => typeof env.REDIS_NODES === 'string' && env.REDIS_NODES.trim().length > 0)
    @IsString()
    @Matches(/^\s*[^:\s]+:\d+\s*(,\s*[^:\s]+:\d+\s*)*$/)
    REDIS_NODES?: MaybeType<string>;

    /**
     * If user starts providing host/port, validate each of them.
     * (Both optional so local defaults can kick in when none are set.)
     */
    @ValidateIf(env => !!env.REDIS_HOST || !!env.REDIS_PORT)
    @IsString()
    REDIS_HOST?: MaybeType<string>;

    @ValidateIf(env => !!env.REDIS_HOST || !!env.REDIS_PORT)
    @IsNumberString()
    REDIS_PORT?: MaybeType<string>;

    @IsOptional() @IsString() REDIS_USERNAME?: MaybeType<string>;
    @IsOptional() @IsString() REDIS_PASSWORD?: MaybeType<string>;
    @IsOptional() @IsNumberString() REDIS_DB?: MaybeType<string>;
    @IsOptional() @IsString() REDIS_KEY_PREFIX?: MaybeType<string>;
    @IsOptional() @IsBooleanString() REDIS_TLS?: MaybeType<string>;
    @IsOptional() @IsString() REDIS_TLS_SERVERNAME?: MaybeType<string>;
    @IsOptional() @IsNumberString() REDIS_MAX_RETRIES_PER_REQUEST?: MaybeType<string>;
    @IsOptional() @IsNumberString() REDIS_RECONNECT_BACKOFF_MS?: MaybeType<string>;
    @IsOptional() @IsNumberString() REDIS_CONNECTION_TIMEOUT_MS?: MaybeType<string>;
    @IsOptional() @IsBooleanString() REDIS_ENABLE_AUTOPIPELINING?: MaybeType<string>;
    @IsOptional() @IsBooleanString() REDIS_LAZY_CONNECT?: MaybeType<string>;
    @IsOptional() @IsBooleanString() REDIS_SUBSCRIBER_CREATE?: MaybeType<string>;
    @IsIn(['none','acl','iam']) @IsOptional() REDIS_AUTH_MODE?: MaybeType<'none'|'acl'|'iam'>;

    @IsString()
    @ValidateIf(env => env.REDIS_AUTH_MODE === 'iam')
    REDIS_IAM_USERNAME?: MaybeType<string>;
}

function parseNodes(list: string): RedisNode[] {
    return list.split(',').map(raw => {
        const pair = raw.trim();
        const [host, portStr] = pair.split(':');
        const port = Number(portStr);
        if (!host || Number.isNaN(port)) {
            throw new Error(`[redis] invalid node "${raw}"`);
        }
        return { host, port };
    });
}

function resolveNodes(env: NodeJS.ProcessEnv): RedisNode[] {
    if (env.REDIS_NODES && env.REDIS_NODES.trim().length > 0) {
        return parseNodes(env.REDIS_NODES);
    }
    // fallback to host/port if given
    if (env.REDIS_HOST || env.REDIS_PORT) {
        const host = (env.REDIS_HOST && env.REDIS_HOST.trim().length > 0) ? env.REDIS_HOST : 'localhost';
        const port = env.REDIS_PORT ? Number(env.REDIS_PORT) : 6379;
        return [{ host, port }];
    }
    // final local default (no env provided)
    return [{ host: 'localhost', port: 6379 }];
}

export default registerAs<RedisConfig>('redisConfig', () => {
    validateConfig(process.env, RedisEnvValidator);

    return {
        mode: (process.env.REDIS_MODE as RedisMode) ?? RedisMode.Standalone,
        nodes: resolveNodes(process.env),

        username: process.env.REDIS_USERNAME || undefined,
        password: process.env.REDIS_PASSWORD || undefined,
        db: process.env.REDIS_DB ? Number(process.env.REDIS_DB) : undefined,
        keyPrefix: process.env.REDIS_KEY_PREFIX || undefined,

        tls: (process.env.REDIS_TLS ?? 'false') === 'true',
        tlsServerName: process.env.REDIS_TLS_SERVERNAME || undefined,

        maxRetriesPerRequest: process.env.REDIS_MAX_RETRIES_PER_REQUEST
            ? Number(process.env.REDIS_MAX_RETRIES_PER_REQUEST) : 3,
        reconnectBackoffMs: process.env.REDIS_RECONNECT_BACKOFF_MS
            ? Number(process.env.REDIS_RECONNECT_BACKOFF_MS) : 200,
        connectionTimeoutMs: process.env.REDIS_CONNECTION_TIMEOUT_MS
            ? Number(process.env.REDIS_CONNECTION_TIMEOUT_MS) : 5000,

        enableAutoPipelining: (process.env.REDIS_ENABLE_AUTOPIPELINING ?? 'true') === 'true',
        lazyConnect: (process.env.REDIS_LAZY_CONNECT ?? 'true') === 'true',

        subscriber: { create: (process.env.REDIS_SUBSCRIBER_CREATE ?? 'true') === 'true' },

        authMode: (process.env.REDIS_AUTH_MODE as 'none'|'acl'|'iam') ?? 'acl',
        iamUsername: process.env.REDIS_IAM_USERNAME || undefined,
    };
});
