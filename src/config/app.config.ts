import { registerAs } from '@nestjs/config';

import { z } from 'zod';

import { Environment } from '@app/types';

const schema = z.object({
    nodeEnv: z.nativeEnum(Environment).default(Environment.Development),
    name: z.string().min(1).default('referral-campaign-service'),
    port: z.coerce.number().int().positive().default(3000),
    apiPrefix: z.string().min(1).default('api'),
    allowedOrigins: z
        .string()
        .transform((val) => val.split(',').map((s) => s.trim()))
        .optional(),
    isWorker: z.boolean().default(false),
    /** Port of the worker pods' probe server (APP_MODE=worker). */
    workerHealthPort: z.coerce.number().int().positive().default(3001),
    invitationExpiryDays: z.coerce.number().int().positive().default(7),
    trialDurationDays: z.coerce.number().int().positive().default(14),
    frontendDomain: z.string().url().optional(),
    /** Tenant custom domains. Off until ACM/CloudFront provisioning exists (NOTE.md, deferred). */
    customDomainsEnabled: z.boolean().default(false)
});

export type AppConfig = z.infer<typeof schema>;

export default registerAs('app', (): AppConfig => {
    const result = schema.safeParse({
        nodeEnv: process.env.NODE_ENV,
        name: process.env.APP_NAME,
        port: process.env.APP_PORT,
        apiPrefix: process.env.APP_API_PREFIX,
        allowedOrigins: process.env.ALLOWED_ORIGINS,
        isWorker: process.env.APP_MODE?.toLowerCase() === 'worker',
        workerHealthPort: process.env.WORKER_HEALTH_PORT,
        invitationExpiryDays: process.env.INVITATION_EXPIRY_DAYS,
        trialDurationDays: process.env.TRIAL_DURATION_DAYS,
        frontendDomain: process.env.FRONTEND_DOMAIN,
        customDomainsEnabled: process.env.FEATURE_CUSTOM_DOMAINS === 'true'
    });

    if (!result.success) {
        throw new Error(`App config validation failed: ${result.error.message}`);
    }
    return result.data;
});
