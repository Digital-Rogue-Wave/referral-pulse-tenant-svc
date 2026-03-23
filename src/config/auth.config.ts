import { registerAs } from '@nestjs/config';

import { z } from 'zod';

const schema = z.object({
    jwksUri: z.string().url(),
    issuer: z.string().url(),
    audience: z.string().min(1),
    algorithms: z.string().transform((val) => val.split(',').map((s) => s.trim())),
    clockTolerance: z.coerce.number().int().min(0),
    cacheEnabled: z.preprocess((val) => val === 'true', z.boolean()),
    cacheTtl: z.coerce.number().int().positive(),
    tenantHeader: z.string(),
    tenantClaimPath: z.string(),
});

export type AuthConfig = z.infer<typeof schema>;

export default registerAs('auth', (): AuthConfig => {
    const result = schema.safeParse({
        jwksUri: process.env.AUTH_JWKS_URI,
        issuer: process.env.AUTH_ISSUER,
        audience: process.env.AUTH_AUDIENCE,
        algorithms: process.env.AUTH_ALGORITHMS,
        clockTolerance: process.env.AUTH_CLOCK_TOLERANCE,
        cacheEnabled: process.env.AUTH_CACHE_ENABLED,
        cacheTtl: process.env.AUTH_CACHE_TTL,
        tenantHeader: process.env.AUTH_TENANT_HEADER,
        tenantClaimPath: process.env.AUTH_TENANT_CLAIM_PATH,
    });

    if (!result.success) {
        throw new Error(`Auth config validation failed: ${result.error.message}`);
    }
    return result.data;
});
