import { registerAs } from '@nestjs/config';

import { z } from 'zod';

const serviceSchema = z.object({
    url: z.string().url(),
    timeout: z.coerce.number().int().positive().default(5000),
});

const schema = z.object({
    tenants: serviceSchema,
    campaigns: serviceSchema,
    rewards: serviceSchema,
    analytics: serviceSchema,
    tracking: serviceSchema,
    referrals: serviceSchema,
    sdkConfig: serviceSchema,
    contentAi: serviceSchema,
    clientIdentity: serviceSchema,
    workflowOrchestration: serviceSchema,
});

export type ServicesConfig = z.infer<typeof schema>;

export default registerAs('services', (): ServicesConfig => {
    const defaultTimeout = process.env.INTRA_HTTP_TIMEOUT_MS ? parseInt(process.env.INTRA_HTTP_TIMEOUT_MS, 10) : 5000;

    const result = schema.safeParse({
        tenants: {
            url: process.env.SERVICE_TENANTS_URL || 'http://localhost:5001',
            timeout: defaultTimeout,
        },
        campaigns: {
            url: process.env.SERVICE_CAMPAIGNS_URL || 'http://localhost:5002',
            timeout: defaultTimeout,
        },
        rewards: {
            url: process.env.SERVICE_REWARDS_URL || 'http://localhost:5003',
            timeout: defaultTimeout,
        },
        analytics: {
            url: process.env.SERVICE_ANALYTICS_URL || 'http://localhost:5004',
            timeout: defaultTimeout,
        },
        tracking: {
            url: process.env.SERVICE_TRACKING_URL || 'http://localhost:5005',
            timeout: defaultTimeout,
        },
        referrals: {
            url: process.env.SERVICE_REFERRALS_URL || 'http://localhost:5006',
            timeout: defaultTimeout,
        },
        sdkConfig: {
            url: process.env.SERVICE_SDK_CONFIG_URL || 'http://localhost:5007',
            timeout: defaultTimeout,
        },
        contentAi: {
            url: process.env.SERVICE_CONTENT_AI_URL || 'http://localhost:5008',
            timeout: defaultTimeout,
        },
        clientIdentity: {
            url: process.env.SERVICE_CLIENT_IDENTITY_URL || 'http://localhost:5009',
            timeout: defaultTimeout,
        },
        workflowOrchestration: {
            url: process.env.SERVICE_WORKFLOW_ORCHESTRATION_URL || 'http://localhost:5010',
            timeout: defaultTimeout,
        },
    });

    if (!result.success) {
        throw new Error(`Services config validation failed: ${result.error.message}`);
    }
    return result.data;
});
