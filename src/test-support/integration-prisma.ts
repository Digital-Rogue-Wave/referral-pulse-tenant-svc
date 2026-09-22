/**
 * Integration specs (`*.integration.spec.ts`) run against the real Docker infrastructure
 * (`pnpm test:integration`). This is their Postgres client; each spec uses its own tenant ids and deletes
 * what it created.
 */
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@prisma-gen/generated/client';

export function integrationPrisma(): PrismaClient {
    const connectionString = process.env.DATABASE_URL ?? 'postgresql://root:root@localhost:5432/tenants';
    return new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString })) });
}
