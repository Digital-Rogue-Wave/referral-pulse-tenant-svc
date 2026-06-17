import { registerAs } from '@nestjs/config';

import { z } from 'zod';

const schema = z.object({
    circuitBreaker: z.object({
        enabled: z.preprocess((val) => val === 'true', z.boolean()).default(true),
        failureThreshold: z.coerce.number().int().positive().default(5),
        halfOpenMaxCalls: z.coerce.number().int().positive().default(3),
        monitoringPeriod: z.coerce.number().int().positive().default(60000),
        timeout: z.coerce.number().int().positive().default(10000),
        errorThresholdPercentage: z.coerce.number().int().min(0).max(100).default(50),
        resetTimeout: z.coerce.number().int().positive().default(30000),
        volumeThreshold: z.coerce.number().int().positive().default(10),
        maxCacheSize: z.coerce.number().int().positive().default(100)
    })
});

export type ResilienceConfig = z.infer<typeof schema>;

export default registerAs('resilience', (): ResilienceConfig => {
    const result = schema.safeParse({
        circuitBreaker: {
            enabled: process.env.CIRCUIT_BREAKER_ENABLED,
            failureThreshold: process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
            halfOpenMaxCalls: process.env.CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS,
            monitoringPeriod: process.env.CIRCUIT_BREAKER_MONITORING_PERIOD,
            timeout: process.env.CIRCUIT_BREAKER_TIMEOUT,
            errorThresholdPercentage: process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD,
            resetTimeout: process.env.CIRCUIT_BREAKER_RESET_TIMEOUT,
            volumeThreshold: process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD,
            maxCacheSize: process.env.CIRCUIT_BREAKER_MAX_CACHE_SIZE
        }
    });

    if (!result.success) {
        throw new Error(`Resilience config validation failed: ${result.error.message}`);
    }
    return result.data;
});
