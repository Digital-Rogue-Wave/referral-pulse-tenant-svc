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
    invitationExpiryDays: z.coerce.number().int().positive().default(7),
    trialDurationDays: z.coerce.number().int().positive().default(14),
    frontendDomain: z.string().url().optional(),
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
        invitationExpiryDays: process.env.INVITATION_EXPIRY_DAYS,
        trialDurationDays: process.env.TRIAL_DURATION_DAYS,
        frontendDomain: process.env.FRONTEND_DOMAIN,
    });

    if (!result.success) {
        throw new Error(`App config validation failed: ${result.error.message}`);
    }
    return result.data;
});
