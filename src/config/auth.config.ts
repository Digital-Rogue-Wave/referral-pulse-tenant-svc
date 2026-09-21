import { registerAs } from '@nestjs/config';

import { z } from 'zod';

/**
 * Token verification (every service). Two issuers are trusted, for two kinds of principal:
 * - the internal JWT minted by tenant-service's /internal/validate-token (dashboard users and API keys,
 *   after the gateway) — Architecture §13.1;
 * - Ory Hydra, for client-credentials tokens only (service-to-service calls on the mesh).
 * The tenant always comes from the verified token; there is no header fallback.
 */
const schema = z.object({
    jwksUri: z.string().url(),
    issuer: z.string().url(),
    audience: z.string().min(1),
    internalJwksUri: z.string().url(),
    internalIssuer: z.string().min(1),
    internalAudience: z.string().min(1),
    algorithms: z.string().transform((val) => val.split(',').map((s) => s.trim())),
    clockTolerance: z.coerce.number().int().min(0),
    cacheEnabled: z.preprocess((val) => val === 'true', z.boolean()),
    cacheTtl: z.coerce.number().int().positive()
});

export type AuthConfig = z.infer<typeof schema>;

export default registerAs('auth', (): AuthConfig => {
    const result = schema.safeParse({
        jwksUri: process.env.AUTH_JWKS_URI,
        issuer: process.env.AUTH_ISSUER,
        audience: process.env.AUTH_AUDIENCE,
        internalJwksUri: process.env.AUTH_INTERNAL_JWKS_URI,
        internalIssuer: process.env.AUTH_INTERNAL_ISSUER,
        internalAudience: process.env.AUTH_INTERNAL_AUDIENCE,
        algorithms: process.env.AUTH_ALGORITHMS,
        clockTolerance: process.env.AUTH_CLOCK_TOLERANCE,
        cacheEnabled: process.env.AUTH_CACHE_ENABLED,
        cacheTtl: process.env.AUTH_CACHE_TTL
    });

    if (!result.success) {
        throw new Error(`Auth config validation failed: ${result.error.message}`);
    }
    return result.data;
});
