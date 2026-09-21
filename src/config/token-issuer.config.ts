import { registerAs } from '@nestjs/config';

import { z } from 'zod';

/**
 * Internal-JWT issuance (tenant-service only — Architecture §13.1).
 *
 * - `privateKeyPem`: ES256 (P-256) private key, base64-encoded PEM so it fits in one env var / secret.
 * - `ttlSeconds`: internal JWT lifetime; API §2 caps it at 15 min because it bounds how stale `perms` can be.
 * - `gatewaySecret`: shared secret the gateway sends as `X-Gateway-Secret` on /internal/validate-token,
 *   so only the gateway can turn a credential into an internal token.
 */
const schema = z.object({
    privateKeyPem: z
        .string()
        .min(1)
        .transform((value) => Buffer.from(value, 'base64').toString('utf8'))
        .refine((pem) => pem.includes('PRIVATE KEY'), 'INTERNAL_JWT_PRIVATE_KEY must be a base64-encoded PEM private key'),
    ttlSeconds: z.coerce.number().int().min(60).max(900),
    gatewaySecret: z.string().min(32)
});

export type TokenIssuerConfig = z.infer<typeof schema>;

export default registerAs('tokenIssuer', (): TokenIssuerConfig => {
    const result = schema.safeParse({
        privateKeyPem: process.env.INTERNAL_JWT_PRIVATE_KEY,
        ttlSeconds: process.env.INTERNAL_JWT_TTL_SECONDS,
        gatewaySecret: process.env.GATEWAY_SHARED_SECRET
    });

    if (!result.success) {
        throw new Error(`Token issuer config validation failed: ${result.error.message}`);
    }
    return result.data;
});
