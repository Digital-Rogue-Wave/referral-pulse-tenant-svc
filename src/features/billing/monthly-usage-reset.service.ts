import { Injectable } from '@nestjs/common';

import { TenantStatus } from '@domains/tenant/tenant.types';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';

import { BillingEvents, UsageMonthlySummaryEvent } from '@domains/billing';

import { PlanLimitService } from './plan-limit.service';
import { UsageCounterService } from './usage-counter.service';

/**
 * On the 1st of the month: publishes `usage.monthly_summary` for each metric of the month that ended.
 * Nothing is reset — monthly counters are keyed by month, so the new month simply starts a new row.
 */
@Injectable()
export class MonthlyUsageResetService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly counters: UsageCounterService,
        private readonly planLimits: PlanLimitService,
        private readonly txEventEmitter: TransactionEventEmitterService
    ) {
        this.logger.setContext(MonthlyUsageResetService.name);
    }

    async runMonthlyReset(now = new Date()): Promise<void> {
        const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
        const month = monthEnd.toISOString().slice(0, 7);
        const periodDate = monthEnd.toISOString().slice(0, 10);
        const tenants = await this.prisma.tenant.findMany({ where: { status: { not: TenantStatus.CLOSED }, deletedAt: null }, select: { id: true } });

        for (const tenant of tenants) {
            try {
                await this.summarise(tenant.id, month, periodDate, now);
            } catch (error) {
                this.logger.error('Monthly usage summary failed for a tenant', error instanceof Error ? error.stack : undefined, {
                    tenantId: tenant.id
                });
            }
        }
    }

    async summarise(tenantId: string, month: string, periodDate: string, now: Date): Promise<void> {
        const usage = await this.counters.forMonth(tenantId, month);
        const limits = (await this.planLimits.getPlanLimits(tenantId)) ?? {};
        await this.prisma.$transaction(async (tx) => {
            for (const [metric, value] of Object.entries(usage)) {
                const limit = typeof limits[metric] === 'number' ? (limits[metric] as number) : null;
                await tx.billingEvent.create({
                    data: {
                        tenantId,
                        eventType: 'usage.monthly_summary',
                        metricName: metric,
                        timestamp: now,
                        metadata: { month, usage: value, limit }
                    }
                });
                // external_id `usage.monthly_summary:{tenant}:{metric}:{month}` makes a re-run publish nothing new.
                this.txEventEmitter.emitAfterCommit(
                    BillingEvents.USAGE_MONTHLY_SUMMARY,
                    new UsageMonthlySummaryEvent(tenantId, tenantId, metric, month, value, limit, periodDate, now.toISOString())
                );
            }
        });
    }
}
