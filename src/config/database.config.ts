import { registerAs } from '@nestjs/config';
import { z } from 'zod';
import { Environment } from '@app/types';

const schema = z.object({
    type: z.literal('postgres').default('postgres'),
    host: z.string().min(1).default('localhost'),
    port: z.coerce.number().int().positive().default(5432),
    username: z.string().min(1).default('postgres'),
    password: z.string().default(''),
    name: z.string().min(1).default('campaign_db'),
    url: z.string().url().optional(),
    maxConnections: z.coerce.number().int().positive().default(100),
    sslEnabled: z.preprocess((val) => val === 'true', z.boolean()).default(false),
    rejectUnauthorized: z.preprocess((val) => val === 'true', z.boolean()).default(false),
    synchronize: z.preprocess((val) => val === 'true', z.boolean()).default(false),
    logging: z.preprocess((val) => val === 'true', z.boolean()).default(false),
});

export type DatabaseConfig = z.infer<typeof schema>;

export default registerAs('database', (): DatabaseConfig => {
    const result = schema.safeParse({
        type: process.env.DATABASE_TYPE,
        host: process.env.DATABASE_HOST,
        port: process.env.DATABASE_PORT,
        username: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        name: process.env.NODE_ENV === Environment.Test ? process.env.DATABASE_TEST_NAME : process.env.DATABASE_NAME,
        url: process.env.DATABASE_URL,
        maxConnections: process.env.DATABASE_MAX_CONNECTIONS,
        sslEnabled: process.env.DATABASE_SSL_ENABLED,
        rejectUnauthorized: process.env.DATABASE_REJECT_UNAUTHORIZED,
        synchronize: process.env.DATABASE_SYNCHRONIZE,
        logging: process.env.DATABASE_LOGGING,
    });

    if (!result.success) {
        throw new Error(`Database config validation failed: ${result.error.message}`);
    }
    return result.data;
});
