import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const schema = z.object({
    timeout: z.coerce.number().int().positive().default(30000),
    maxRedirects: z.coerce.number().int().min(0).default(5),
    retryAttempts: z.coerce.number().int().min(0).default(3),
    retryDelay: z.coerce.number().int().positive().default(1000),
    retryMaxDelay: z.coerce.number().int().positive().default(30000),
    retryExponential: z.preprocess((val) => val === 'true', z.boolean()).default(true),
    internalServiceDomains: z
        .preprocess(
            (val) => (typeof val === 'string' ? val.split(',').map((s) => s.trim()) : []),
            z.array(z.string()),
        )
        .default([]),
    circuitBreaker: z.object({
        enabled: z.preprocess((val) => val === 'true', z.boolean()).default(true),
        timeout: z.coerce.number().int().positive().default(10000),
        errorThresholdPercentage: z.coerce.number().int().min(0).max(100).default(50),
        resetTimeout: z.coerce.number().int().positive().default(30000),
        volumeThreshold: z.coerce.number().int().positive().default(10),
        maxCacheSize: z.coerce.number().int().positive().default(100),
    }),
});

export type HttpConfig = z.infer<typeof schema>;

export default registerAs('http', (): HttpConfig => {
    const result = schema.safeParse({
        timeout: process.env.HTTP_CLIENT_TIMEOUT,
        maxRedirects: process.env.HTTP_CLIENT_MAX_REDIRECTS,
        retryAttempts: process.env.HTTP_CLIENT_RETRY_ATTEMPTS,
        retryDelay: process.env.HTTP_CLIENT_RETRY_DELAY,
        retryMaxDelay: process.env.HTTP_CLIENT_RETRY_MAX_DELAY,
        retryExponential: process.env.HTTP_CLIENT_RETRY_EXPONENTIAL,
        internalServiceDomains: process.env.HTTP_INTERNAL_SERVICE_DOMAINS,
        circuitBreaker: {
            enabled: process.env.CIRCUIT_BREAKER_ENABLED,
            timeout: process.env.CIRCUIT_BREAKER_TIMEOUT,
            errorThresholdPercentage: process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD,
            resetTimeout: process.env.CIRCUIT_BREAKER_RESET_TIMEOUT,
            volumeThreshold: process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD,
            maxCacheSize: process.env.CIRCUIT_BREAKER_MAX_CACHE_SIZE,
        },
    });

    if (!result.success) {
        throw new Error(`HTTP config validation failed: ${result.error.message}`);
    }
    return result.data;
});
