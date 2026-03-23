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
        .preprocess((val) => (typeof val === 'string' ? val.split(',').map((s) => s.trim()) : []), z.array(z.string()))
        .default([]),
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
    });

    if (!result.success) {
        throw new Error(`HTTP config validation failed: ${result.error.message}`);
    }
    return result.data;
});
