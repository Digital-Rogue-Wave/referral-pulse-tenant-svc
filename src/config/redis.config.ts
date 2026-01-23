import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const schema = z.object({
    host: z.string().min(1).default('localhost'),
    port: z.coerce.number().int().positive().default(6379),
    password: z.string().optional(),
    db: z.coerce.number().int().min(0).max(15).default(0),
    keyPrefix: z.string().default('campaign:'),
    tlsEnabled: z.preprocess((val) => val === 'true', z.boolean()).default(false),
    clusterEnabled: z.preprocess((val) => val === 'true', z.boolean()).default(false),
    clusterNodes: z
        .string()
        .transform((val) => (val ? val.split(',').map((s) => s.trim()) : []))
        .optional(),
    maxRetriesPerRequest: z.coerce.number().int().positive().default(3),
    connectTimeout: z.coerce.number().int().positive().default(10000),
    commandTimeout: z.coerce.number().int().positive().default(5000),
    retryDelayMs: z.coerce.number().int().positive().default(50),
    maxRetryDelayMs: z.coerce.number().int().positive().default(2000),
    defaultTtl: z.coerce.number().int().positive().default(3600),
    lockTtl: z.coerce.number().int().positive().default(30000),
    // AWS ElastiCache IAM Authentication
    iamAuthEnabled: z.preprocess((val) => val === 'true', z.boolean()).default(false),
    iamAuthUsername: z.string().min(1).default('default'),
});

export type RedisConfig = z.infer<typeof schema>;

export default registerAs('redis', (): RedisConfig => {
    const result = schema.safeParse({
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD,
        db: process.env.REDIS_DB,
        keyPrefix: process.env.REDIS_KEY_PREFIX,
        tlsEnabled: process.env.REDIS_TLS_ENABLED,
        clusterEnabled: process.env.REDIS_CLUSTER_ENABLED,
        clusterNodes: process.env.REDIS_CLUSTER_NODES,
        maxRetriesPerRequest: process.env.REDIS_MAX_RETRIES_PER_REQUEST,
        connectTimeout: process.env.REDIS_CONNECT_TIMEOUT,
        commandTimeout: process.env.REDIS_COMMAND_TIMEOUT,
        retryDelayMs: process.env.REDIS_RETRY_DELAY_MS,
        maxRetryDelayMs: process.env.REDIS_MAX_RETRY_DELAY_MS,
        defaultTtl: process.env.REDIS_DEFAULT_TTL,
        lockTtl: process.env.REDIS_LOCK_TTL,
        iamAuthEnabled: process.env.REDIS_IAM_AUTH_ENABLED,
        iamAuthUsername: process.env.REDIS_IAM_AUTH_USERNAME,
    });

    if (!result.success) {
        throw new Error(`Redis config validation failed: ${result.error.message}`);
    }
    return result.data;
});
