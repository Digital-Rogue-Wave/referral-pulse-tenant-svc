import { Injectable } from '@nestjs/common';

import { TenantStatusEnum } from '@common/enums/tenant.enum';

import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisService } from '@common/redis/redis.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';

import { BillingEvents, UsageThresholdCrossedEvent } from '@domains/billing';

@Injectable()
export class DailyUsageCalculator {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService,
        private readonly redis: RedisService,
        private readonly txEventEmitter: TransactionEventEmitterService,
    ) {
        this.logger.setContext(DailyUsageCalculator.name);
    }

    async runDailySnapshot(): Promise<void> {
        const now = new Date();
        const periodDate = now.toISOString().slice(0, 10);
        const month = now.toISOString().slice(0, 7);

        this.logger.log(`Running daily usage snapshot for date ${periodDate}`);

        const tenants = await this.prisma.tenant.findMany({
            where: { status: TenantStatusEnum.ACTIVE, deletedAt: null },
        });

        for (const tenant of tenants) {
            await this.tenantContext.runWithContext({ tenantId: tenant.id }, () =>
                this.snapshotTenant(tenant.id, periodDate, month, now),
            );
        }
    }

    private async snapshotTenant(tenantId: string, periodDate: string, month: string, now: Date): Promise<void> {
        const metrics = await this.redis.listMetrics();
        if (!metrics || metrics.length === 0) {
            return;
        }

        for (const metric of metrics) {
            await this.snapshotMetric(tenantId, metric, periodDate, month, now);
        }
    }

    private async snapshotMetric(
        tenantId: string,
        metric: string,
        periodDate: string,
        month: string,
        now: Date,
    ): Promise<void> {
        const usage = await this.redis.getUsage(metric, month);
        const limit = await this.redis.getLimit(metric);

        await this.upsertUsageRow(tenantId, metric, periodDate, usage, limit);

        if (limit && limit > 0) {
            const percentage = (usage / limit) * 100;
            await this.checkThresholds(tenantId, metric, usage, limit, percentage, periodDate, month, now);
        }
    }

    private async upsertUsageRow(
        tenantId: string,
        metric: string,
        periodDate: string,
        usage: number,
        limit: number | null,
    ): Promise<void> {
        const existing = await this.prisma.tenantUsage.findFirst({
            where: { tenantId, metricName: metric, periodDate, deletedAt: null },
        });

        if (!existing) {
            await this.prisma.tenantUsage.create({
                data: { tenantId, metricName: metric, periodDate, currentUsage: usage, limitValue: limit ?? null },
            });
        } else {
            await this.prisma.tenantUsage.update({
                where: { id: existing.id },
                data: { currentUsage: usage, limitValue: limit !== null ? limit : existing.limitValue },
            });
        }
    }

    private async checkThresholds(
        tenantId: string,
        metric: string,
        usage: number,
        limit: number,
        percentage: number,
        periodDate: string,
        month: string,
        now: Date,
    ): Promise<void> {
        for (const threshold of [80, 100]) {
            if (percentage < threshold) {
                continue;
            }

            const alreadyTriggered = await this.redis.isThresholdTriggered(metric, threshold);
            if (alreadyTriggered) {
                continue;
            }

            await this.redis.markThresholdTriggered(metric, threshold);

            await this.prisma.billingEvent.create({
                data: {
                    tenantId,
                    eventType: 'usage.threshold_crossed',
                    metricName: metric,
                    increment: null,
                    timestamp: new Date(),
                    metadata: { threshold, usage, limit, percentage },
                },
            });

            this.logger.warn(
                `Usage threshold ${threshold}% crossed for tenant ${tenantId}, metric ${metric} (usage=${usage}, limit=${limit})`,
            );

            this.txEventEmitter.emitAfterCommit(
                BillingEvents.USAGE_THRESHOLD_CROSSED,
                new UsageThresholdCrossedEvent(tenantId, tenantId, metric, threshold, usage, limit, percentage, periodDate, now.toISOString()),
            );
        }
    }
}
