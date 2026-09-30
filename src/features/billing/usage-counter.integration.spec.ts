import type { PrismaClient } from '@prisma-gen/generated/client';

import type { DatabaseService } from '@app/database/database.service';
import { integrationPrisma } from '@app/test-support/integration-prisma';

import { periodOf, UsageCounterService } from './usage-counter.service';

/** Runs on real Postgres: the guarantees are those of the SQL statements, so mocks would prove nothing. */
describe('UsageCounterService (Postgres)', () => {
    const TENANT = 'itest-usage-counter-000001';
    let prisma: PrismaClient;
    let counters: UsageCounterService;

    beforeAll(() => {
        prisma = integrationPrisma();
        counters = new UsageCounterService(prisma as unknown as DatabaseService);
    });

    beforeEach(async () => {
        await prisma.usageCounter.deleteMany({ where: { tenantId: TENANT } });
    });

    afterAll(async () => {
        await prisma.usageCounter.deleteMany({ where: { tenantId: TENANT } });
        await prisma.$disconnect();
    });

    it('never lets concurrent callers overshoot the limit: 20 parallel requests against a limit of 10 add exactly 10', async () => {
        const results = await Promise.all(Array.from({ length: 20 }, () => counters.consume(TENANT, 'email_sends', 1, 10)));

        expect(results.filter((value) => value !== null)).toHaveLength(10);
        expect(results.filter((value) => value === null)).toHaveLength(10);
        await expect(counters.get(TENANT, 'email_sends')).resolves.toBe(10);
    });

    it('never loses an increment under concurrency when there is no limit', async () => {
        await Promise.all(Array.from({ length: 25 }, () => counters.consume(TENANT, 'referred_users', 2, null)));

        await expect(counters.get(TENANT, 'referred_users')).resolves.toBe(50);
    });

    it('refuses a single request larger than the limit without touching the counter', async () => {
        await expect(counters.consume(TENANT, 'email_sends', 11, 10)).resolves.toBeNull();
        await expect(counters.get(TENANT, 'email_sends')).resolves.toBe(0);
    });

    it('releases down to zero and never below', async () => {
        await counters.consume(TENANT, 'campaigns', 2, null);

        await expect(counters.release(TENANT, 'campaigns', 5)).resolves.toBe(0);
    });

    it('keys monthly metrics by month and gauges by `current`, so a new month starts from zero without a reset', () => {
        expect(periodOf('email_sends', new Date('2026-09-30T23:59:59Z'))).toBe('2026-09');
        expect(periodOf('email_sends', new Date('2026-10-01T00:00:00Z'))).toBe('2026-10');
        expect(periodOf('campaigns')).toBe('current');
    });
});
