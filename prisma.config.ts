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
    // Migrations run as the privileged role: the application role (DATABASE_URL) cannot create tables, and row-level
    // security binds it (v5.2 DB Model §0.8).
    datasource: {
        url: process.env.DATABASE_PRIVILEGED_URL!
    }
});
