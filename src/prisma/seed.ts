import { PrismaClient } from './generated/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
}

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const usd = await prisma.currency.upsert({
        where: { code: 'USD' },
        update: {},
        create: {
            code: 'USD',
            name: 'US Dollar',
            symbol: '$',
            decimals: 2,
        },
    });

    const eur = await prisma.currency.upsert({
        where: { code: 'EUR' },
        update: {},
        create: {
            code: 'EUR',
            name: 'Euro',
            symbol: '€',
            decimals: 2,
        },
    });

    console.log({ usd, eur });
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });