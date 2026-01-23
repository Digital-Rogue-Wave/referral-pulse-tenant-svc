import { registerAs } from '@nestjs/config';
import { z } from 'zod';

const schema = z.object({
    campaign: z.object({
        url: z.string().url().default('http://campaign-service:3000'),
        timeout: z.coerce.number().int().positive().default(5000),
    }),
    tenant: z.object({
        url: z.string().url().default('http://tenant-service:3000'),
        timeout: z.coerce.number().int().positive().default(5000),
    }),
    tracking: z.object({
        url: z.string().url().default('http://tracking-service:3000'),
        timeout: z.coerce.number().int().positive().default(5000),
    }),
    reward: z.object({
        url: z.string().url().default('http://reward-service:3000'),
        timeout: z.coerce.number().int().positive().default(5000),
    }),
    referral: z.object({
        url: z.string().url().default('http://referral-service:3000'),
        timeout: z.coerce.number().int().positive().default(5000),
    }),
});

export type ServicesConfig = z.infer<typeof schema>;

export default registerAs('services', (): ServicesConfig => {
    const result = schema.safeParse({
        campaign: {
            url: process.env.CAMPAIGN_SERVICE_URL,
            timeout: process.env.CAMPAIGN_SERVICE_TIMEOUT,
        },
        tenant: {
            url: process.env.TENANT_SERVICE_URL,
            timeout: process.env.TENANT_SERVICE_TIMEOUT,
        },
        tracking: {
            url: process.env.TRACKING_SERVICE_URL,
            timeout: process.env.TRACKING_SERVICE_TIMEOUT,
        },
        reward: {
            url: process.env.REWARD_SERVICE_URL,
            timeout: process.env.REWARD_SERVICE_TIMEOUT,
        },
        referral: {
            url: process.env.REFERRAL_SERVICE_URL,
            timeout: process.env.REFERRAL_SERVICE_TIMEOUT,
        },
    });

    if (!result.success) {
        throw new Error(`Services config validation failed: ${result.error.message}`);
    }
    return result.data;
});