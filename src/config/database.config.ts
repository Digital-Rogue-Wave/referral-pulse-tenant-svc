import { registerAs } from '@nestjs/config';

import { z } from 'zod';

/**
 * Database configuration schema for Prisma
 * - `url` is the primary connection string (DATABASE_URL)
 */
export const databaseSchema = z.object({
    url: z.string().min(1),
    maxConnections: z.coerce.number().int().positive().default(20),
    logging: z.preprocess((val) => val === 'true', z.boolean()).default(false),
});

export type DatabaseConfig = z.infer<typeof databaseSchema>;

export default registerAs('database', (): DatabaseConfig => {
    const result = databaseSchema.safeParse({
        url: process.env.DATABASE_URL,
        maxConnections: process.env.DATABASE_MAX_CONNECTIONS,
        logging: process.env.DATABASE_LOGGING,
    });

    if (!result.success) {
        throw new Error(`Database config validation failed: ${result.error.message}`);
    }

    return result.data;
});
