import { Injectable } from '@nestjs/common';

import type { TenantUsage } from '@prisma-gen/generated/client';

import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisService } from '@common/redis/redis.service';
import { DateService } from '@common/helper/date.service';

@Injectable()
export class UsageTrackerService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService,
        private readonly redis: RedisService,
        private readonly dateService: DateService,
    ) {
        this.logger.setContext(UsageTrackerService.name);
    }

    private getTodayDate(): string {
        return this.dateService.format(this.dateService.nowMoment(), 'YYYY-MM-DD');
    }

    private async getOrCreateUsageRow(tenantId: string, metricName: string, periodDate: string): Promise<TenantUsage> {
        let row = await this.prisma.tenantUsage.findFirst({
            where: {
                tenantId,
                metricName,
                periodDate,
                deletedAt: null,
            },
        });

        if (!row) {
            row = await this.prisma.tenantUsage.create({
                data: {
                    tenantId,
                    metricName,
                    periodDate,
                    currentUsage: 0,
                    limitValue: null,
                },
            });
        }

        return row;
    }

    async increment(metricName: string, amount = 1): Promise<number> {
        if (amount <= 0) {
            return this.getUsage(metricName);
        }

        const periodDate = this.getTodayDate();
        const tenantId = this.tenantContext.getTenantId();

        if (!tenantId) {
            this.logger.warn(`No tenantId in context for usage increment of metric ${metricName}`);
            return 0;
        }

        await this.tenantContext.runWithContext({ tenantId }, () =>
            this.redis.incrementUsage(metricName, amount),
        );

        const row = await this.getOrCreateUsageRow(tenantId, metricName, periodDate);

        const updated = await this.prisma.tenantUsage.update({
            where: { id: row.id },
            data: { currentUsage: row.currentUsage + amount },
        });

        return updated.currentUsage;
    }

    async decrement(metricName: string, amount = 1): Promise<number> {
        if (amount <= 0) {
            return this.getUsage(metricName);
        }

        const periodDate = this.getTodayDate();
        const tenantId = this.tenantContext.getTenantId();

        if (!tenantId) {
            this.logger.warn(`No tenantId in context for usage decrement of metric ${metricName}`);
            return 0;
        }

        await this.tenantContext.runWithContext({ tenantId }, () =>
            this.redis.decrementUsage(metricName, amount),
        );

        const row = await this.getOrCreateUsageRow(tenantId, metricName, periodDate);
        const newUsage = Math.max(0, row.currentUsage - amount);

        const updated = await this.prisma.tenantUsage.update({
            where: { id: row.id },
            data: { currentUsage: newUsage },
        });

        return updated.currentUsage;
    }

    async getUsage(metricName: string, periodDate?: string): Promise<number> {
        const date = periodDate ?? this.getTodayDate();
        const tenantId = this.tenantContext.getTenantId();

        if (!tenantId) {
            return 0;
        }

        const row = await this.prisma.tenantUsage.findFirst({
            where: {
                tenantId,
                metricName,
                periodDate: date,
                deletedAt: null,
            },
        });

        return row?.currentUsage ?? 0;
    }
}
