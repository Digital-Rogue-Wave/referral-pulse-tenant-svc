import { registerAs } from '@nestjs/config';

import { z } from 'zod';

/**
 * Company verification through a KYB provider (Product Spec R-INT-02, E1 D15). The provider is Sumsub; `fake` is for
 * tests and for a local stack without sandbox keys — it returns a local link and never calls anyone.
 *
 * Sumsub credentials are read when a session is opened, not at boot, so a deployment that never opens one still starts;
 * with `sumsub` selected and no credentials, opening a session fails loudly instead of pretending.
 */
const schema = z.object({
    provider: z.enum(['sumsub', 'fake']).default('fake'),
    sumsubBaseUrl: z.string().url().default('https://api.sumsub.com'),
    sumsubAppToken: z.string().optional(),
    sumsubSecretKey: z.string().optional(),
    /** The Sumsub verification level configured for company (KYB) checks — case-sensitive, set in the Sumsub dashboard. */
    sumsubLevelName: z.string().optional(),
    /** How long the hosted verification link stays valid. Sumsub's default is 1800 s; the maximum is 30 days. */
    linkTtlSeconds: z.coerce.number().int().positive().max(2_592_000).default(1800)
});

export type KybConfig = z.infer<typeof schema>;

export default registerAs('kyb', (): KybConfig => {
    const result = schema.safeParse({
        provider: process.env.KYB_PROVIDER || undefined,
        sumsubBaseUrl: process.env.SUMSUB_BASE_URL || undefined,
        sumsubAppToken: process.env.SUMSUB_APP_TOKEN || undefined,
        sumsubSecretKey: process.env.SUMSUB_SECRET_KEY || undefined,
        sumsubLevelName: process.env.SUMSUB_LEVEL_NAME || undefined,
        linkTtlSeconds: process.env.KYB_LINK_TTL_SECONDS || undefined
    });
    if (!result.success) {
        throw new Error(`KYB config validation failed: ${result.error.message}`);
    }
    return result.data;
});
