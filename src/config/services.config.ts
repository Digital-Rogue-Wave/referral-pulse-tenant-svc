import { registerAs } from '@nestjs/config';

import { z } from 'zod';

const serviceSchema = z.object({
    url: z.string().url(),
    timeout: z.coerce.number().int().positive().default(5000)
});

/**
 * This service's own Hydra client-credentials identity, for calls to another service's internal API
 * (API Contract §2). Optional so a deployment without a registered client still boots;
 * `ServiceTokenProvider` fails loudly the first time it actually needs a token.
 */
const serviceAuthSchema = z.object({
    tokenUrl: z.string().url().optional(),
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    audience: z.string().min(1).optional()
});

const schema = z.object({
    auth: serviceAuthSchema,
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
    /**
     * notification-service, one of the six erasure targets Product Spec R-CPL-02 names. The default
     * port is the one notification-service actually runs on locally, which `tracking` above also
     * claims — that older default looks wrong, but it is not this change's to move.
     */
    notifications: serviceSchema
});

export type ServicesConfig = z.infer<typeof schema>;

export default registerAs('services', (): ServicesConfig => {
    const defaultTimeout = process.env.INTRA_HTTP_TIMEOUT_MS ? parseInt(process.env.INTRA_HTTP_TIMEOUT_MS, 10) : 5000;

    const result = schema.safeParse({
        auth: {
            tokenUrl: process.env.SERVICE_AUTH_TOKEN_URL,
            clientId: process.env.SERVICE_AUTH_CLIENT_ID,
            clientSecret: process.env.SERVICE_AUTH_CLIENT_SECRET,
            audience: process.env.SERVICE_AUTH_AUDIENCE
        },
        tenants: {
            url: process.env.SERVICE_TENANTS_URL || 'http://localhost:5001',
            timeout: defaultTimeout
        },
        campaigns: {
            url: process.env.SERVICE_CAMPAIGNS_URL || 'http://localhost:5002',
            timeout: defaultTimeout
        },
        rewards: {
            url: process.env.SERVICE_REWARDS_URL || 'http://localhost:5003',
            timeout: defaultTimeout
        },
        analytics: {
            url: process.env.SERVICE_ANALYTICS_URL || 'http://localhost:5004',
            timeout: defaultTimeout
        },
        tracking: {
            url: process.env.SERVICE_TRACKING_URL || 'http://localhost:5005',
            timeout: defaultTimeout
        },
        referrals: {
            url: process.env.SERVICE_REFERRALS_URL || 'http://localhost:5006',
            timeout: defaultTimeout
        },
        sdkConfig: {
            url: process.env.SERVICE_SDK_CONFIG_URL || 'http://localhost:5007',
            timeout: defaultTimeout
        },
        contentAi: {
            url: process.env.SERVICE_CONTENT_AI_URL || 'http://localhost:5008',
            timeout: defaultTimeout
        },
        clientIdentity: {
            url: process.env.SERVICE_CLIENT_IDENTITY_URL || 'http://localhost:5009',
            timeout: defaultTimeout
        },
        workflowOrchestration: {
            url: process.env.SERVICE_WORKFLOW_ORCHESTRATION_URL || 'http://localhost:5010',
            timeout: defaultTimeout
        },
        notifications: {
            url: process.env.SERVICE_NOTIFICATIONS_URL || 'http://localhost:5005',
            timeout: defaultTimeout
        }
    });

    if (!result.success) {
        throw new Error(`Services config validation failed: ${result.error.message}`);
    }
    return result.data;
});
