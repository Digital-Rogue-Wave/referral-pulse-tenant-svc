import { Injectable } from '@nestjs/common';

import { TenantStatus } from '@domains/tenant/tenant.types';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';

import { BillingEvents, UsageThresholdCrossedEvent } from '@domains/billing';

import { PlanLimitService } from './plan-limit.service';
import { UsageCounterService } from './usage-counter.service';

/** Percentages of a limit at which the tenant is warned, once per metric and month. */
export const USAGE_THRESHOLDS = [80, 100] as const;

/**
 * Nightly: writes each open tenant's usage into `tenant_usages` (daily history for the usage chart) and
 * announces `usage.threshold_crossed` the first time a metric reaches 80 % / 100 % of its limit in a month.
 * Reads the durable `usage_counters`; limits come from the plan catalog.
 */
@Injectable()
export class DailyUsageCalculator {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly counters: UsageCounterService,
        private readonly planLimits: PlanLimitService,
        private readonly txEventEmitter: TransactionEventEmitterService
    ) {
        this.logger.setContext(DailyUsageCalculator.name);
    }

    async runDailySnapshot(now = new Date()): Promise<void> {
        const tenants = await this.prisma.tenant.findMany({ where: { status: { not: TenantStatus.CLOSED }, deletedAt: null }, select: { id: true } });
        for (const tenant of tenants) {
            try {
                await this.snapshotTenant(tenant.id, now);
            } catch (error) {
                this.logger.error('Daily usage snapshot failed for a tenant', error instanceof Error ? error.stack : undefined, {
                    tenantId: tenant.id
                });
            }
        }
    }

    async snapshotTenant(tenantId: string, now: Date): Promise<void> {
        const periodDate = now.toISOString().slice(0, 10);
        const month = periodDate.slice(0, 7);
        const limits = (await this.planLimits.getPlanLimits(tenantId)) ?? {};
        const usage = await this.counters.current(tenantId);
        const metrics = new Set([...Object.keys(usage), ...Object.keys(limits)]);

        for (const metric of metrics) {
            const value = await this.planLimits.usageOf(tenantId, metric);
            const limit = typeof limits[metric] === 'number' ? (limits[metric] as number) : null;
            await this.prisma.tenantUsage.upsert({
                where: { tenantId_metricName_periodDate: { tenantId, metricName: metric, periodDate } },
                create: { tenantId, metricName: metric, periodDate, currentUsage: value, limitValue: limit },
                update: { currentUsage: value, limitValue: limit }
            });
            if (limit && limit > 0) {
                await this.announceThresholds(tenantId, metric, value, limit, month, now);
            }
        }
    }

    private async announceThresholds(tenantId: string, metric: string, usage: number, limit: number, month: string, now: Date): Promise<void> {
        const percentage = (usage / limit) * 100;
        for (const threshold of USAGE_THRESHOLDS.filter((t) => percentage >= t)) {
            const alreadyAnnounced = await this.prisma.billingEvent.count({
                where: {
                    tenantId,
                    eventType: 'usage.threshold_crossed',
                    metricName: metric,
                    AND: [{ metadata: { path: ['month'], equals: month } }, { metadata: { path: ['threshold'], equals: threshold } }]
                }
            });
            if (alreadyAnnounced > 0) {
                continue;
            }
            await this.prisma.$transaction(async (tx) => {
                await tx.billingEvent.create({
                    data: {
                        tenantId,
                        eventType: 'usage.threshold_crossed',
                        metricName: metric,
                        timestamp: now,
                        metadata: { month, threshold, usage, limit, percentage }
                    }
                });
                this.txEventEmitter.emitAfterCommit(
                    BillingEvents.USAGE_THRESHOLD_CROSSED,
                    new UsageThresholdCrossedEvent(tenantId, tenantId, metric, threshold, usage, limit, percentage, month, now.toISOString())
                );
            });
            this.logger.warn('Usage threshold crossed', { tenantId, metric, threshold, usage, limit });
        }
    }
}
