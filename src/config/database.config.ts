import { registerAs } from '@nestjs/config';

import { z } from 'zod';

/**
 * Database configuration schema for Prisma
 * - `url` is the primary connection string (DATABASE_URL): the application role, bound by row-level security
 * - `privilegedUrl` (DATABASE_PRIVILEGED_URL) is the role that bypasses it, for migrations and the audited cross-tenant
 *   paths only (v5.2 DB Model §0.8)
 */
export const databaseSchema = z.object({
    url: z.string().min(1),
    privilegedUrl: z.string().min(1),
    maxConnections: z.coerce.number().int().positive().default(20),
    logging: z.preprocess((val) => val === 'true', z.boolean()).default(false)
});

export type DatabaseConfig = z.infer<typeof databaseSchema>;

export default registerAs('database', (): DatabaseConfig => {
    const result = databaseSchema.safeParse({
        url: process.env.DATABASE_URL,
        privilegedUrl: process.env.DATABASE_PRIVILEGED_URL,
        maxConnections: process.env.DATABASE_MAX_CONNECTIONS,
        logging: process.env.DATABASE_LOGGING
    });

    if (!result.success) {
        throw new Error(`Database config validation failed: ${result.error.message}`);
    }

    return result.data;
});
