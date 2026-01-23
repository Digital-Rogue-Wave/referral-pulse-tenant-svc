import { registerAs } from '@nestjs/config';
import { z } from 'zod';
import { Environment } from '@app/types';

const schema = z.object({
    nodeEnv: z.nativeEnum(Environment).default(Environment.Development),
    name: z.string().min(1).default('referral-campaign-service'),
    port: z.coerce.number().int().positive().default(3000),
    apiPrefix: z.string().min(1).default('api'),
    allowedOrigins: z
        .string()
        .transform((val) => val.split(',').map((s) => s.trim()))
        .optional(),
});

export type AppConfig = z.infer<typeof schema>;

export default registerAs('app', (): AppConfig => {
    const result = schema.safeParse({
        nodeEnv: process.env.NODE_ENV,
        name: process.env.APP_NAME,
        port: process.env.APP_PORT,
        apiPrefix: process.env.APP_API_PREFIX,
        allowedOrigins: process.env.ALLOWED_ORIGINS,
    });

    if (!result.success) {
        throw new Error(`App config validation failed: ${result.error.message}`);
    }
    return result.data;
});
