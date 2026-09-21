import { registerAs } from '@nestjs/config';

import { z } from 'zod';

const schema = z.object({
    hydra: z.object({
        publicUrl: z.string(),
        jwksUrl: z.string().optional(),
        issuer: z.string()
    }),
    keto: z.object({
        readUrl: z.string().url(),
        writeUrl: z.string().url()
    }),
    kratos: z.object({
        adminUrl: z.string().url(),
        publicUrl: z.string().url()
    }),
    audience: z.string(),
    /** Shared secret Kratos sends as `X-Ory-Api-Key` on its web hooks. Required — an empty value used to disable the check. */
    webhookApiKey: z.string().min(32)
});

export type OryConfig = z.infer<typeof schema>;

export default registerAs('oryConfig', (): OryConfig => {
    const hydraPublicUrl = process.env.ORY_HYDRA_PUBLIC_URL as string;
    const jwksUrl = process.env.ORY_HYDRA_JWKS_URL || `${hydraPublicUrl}/.well-known/jwks.json`;

    const result = schema.safeParse({
        hydra: {
            publicUrl: hydraPublicUrl,
            jwksUrl,
            issuer: process.env.ORY_HYDRA_ISSUER
        },
        keto: {
            readUrl: process.env.ORY_KETO_READ_URL,
            writeUrl: process.env.ORY_KETO_WRITE_URL
        },
        kratos: {
            adminUrl: process.env.ORY_KRATOS_ADMIN_URL,
            publicUrl: process.env.ORY_KRATOS_PUBLIC_URL
        },
        audience: process.env.JWT_AUDIENCE,
        webhookApiKey: process.env.ORY_WEBHOOK_API_KEY
    });

    if (!result.success) {
        throw new Error(`Ory config validation failed: ${result.error.message}`);
    }
    return result.data;
});
