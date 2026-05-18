import * as dotenv from 'dotenv';
import * as path from 'path';
import { defineConfig } from 'prisma/config';

// Load environment-specific configurations
const nodeEnv = process.env.NODE_ENV || 'development';
const envPath = path.resolve(process.cwd(), `.env.${nodeEnv}`);
dotenv.config({ path: envPath });

// Load base .env as fallback
dotenv.config();

export default defineConfig({
    schema: 'src/prisma',
    migrations: {
        path: 'src/prisma/migrations',
        seed: 'tsx src/prisma/seed.ts'
    },
    datasource: {
        url: process.env.DATABASE_URL!
    }
});
