import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';

/**
 * Metrics that count what exists now (a gauge), not what happened this month. They never reset. Everything
 * else is metered per calendar month (UTC). Seats are not counted here: they are the tenant's users and
 * pending invitations, read from their own tables.
 */
export const GAUGE_METRICS: ReadonlySet<string> = new Set(['campaigns']);
const GAUGE_PERIOD = 'current';

export const periodOf = (metric: string, at = new Date()): string => (GAUGE_METRICS.has(metric) ? GAUGE_PERIOD : at.toISOString().slice(0, 7));

/**
 * Durable usage counters in `usage_counters`. Every change is a single SQL statement, so concurrent callers
 * can neither lose an increment nor push a counter past its limit.
 */
@Injectable()
export class UsageCounterService {
    constructor(private readonly prisma: DatabaseService) {}

    /**
     * Adds `amount` if the result stays within `limit` (null = unlimited). Returns the new value, or null
     * when the limit would be exceeded (nothing is added then).
     */
    async consume(tenantId: string, metric: string, amount: number, limit: number | null): Promise<number | null> {
        if (limit !== null && amount > limit) {
            return null;
        }
        const period = periodOf(metric);
        const rows = await this.prisma.$queryRaw<Array<{ value: number }>>`
            INSERT INTO usage_counters (tenant_id, metric, period, value, updated_at)
            VALUES (${tenantId}, ${metric}, ${period}, ${amount}, now())
            ON CONFLICT (tenant_id, metric, period) DO UPDATE
                SET value = usage_counters.value + EXCLUDED.value, updated_at = now()
                WHERE ${limit}::int IS NULL OR usage_counters.value + EXCLUDED.value <= ${limit}::int
            RETURNING value`;
        return rows[0]?.value ?? null;
    }

    /** Takes `amount` back (never below zero). Returns the new value. */
    async release(tenantId: string, metric: string, amount: number): Promise<number> {
        const rows = await this.prisma.$queryRaw<Array<{ value: number }>>`
            UPDATE usage_counters SET value = GREATEST(value - ${amount}, 0), updated_at = now()
            WHERE tenant_id = ${tenantId} AND metric = ${metric} AND period = ${periodOf(metric)}
            RETURNING value`;
        return rows[0]?.value ?? 0;
    }

    async get(tenantId: string, metric: string, period = periodOf(metric)): Promise<number> {
        const row = await this.prisma.usageCounter.findUnique({ where: { tenantId_metric_period: { tenantId, metric, period } } });
        return row?.value ?? 0;
    }

    /** Every counter of the tenant for the current month, plus its gauges. */
    async current(tenantId: string): Promise<Record<string, number>> {
        const rows = await this.prisma.usageCounter.findMany({
            where: { tenantId, period: { in: [periodOf(''), GAUGE_PERIOD] } },
            select: { metric: true, value: true }
        });
        return Object.fromEntries(rows.map((row) => [row.metric, row.value]));
    }

    /** Monthly counters of one month (`YYYY-MM`), for the monthly summary. */
    async forMonth(tenantId: string, month: string): Promise<Record<string, number>> {
        const rows = await this.prisma.usageCounter.findMany({ where: { tenantId, period: month }, select: { metric: true, value: true } });
        return Object.fromEntries(rows.map((row) => [row.metric, row.value]));
    }
}
