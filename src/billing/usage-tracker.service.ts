import { Injectable } from '@nestjs/common';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { TenantUsageEntity } from './tenant-usage.entity';

@Injectable()
export class UsageTrackerService {
    constructor(
        @InjectTenantAwareRepository(TenantUsageEntity)
        private readonly usageRepository: TenantAwareRepository<TenantUsageEntity>
    ) {}

    private getTodayDate(): string {
        const now = new Date();
        return now.toISOString().slice(0, 10);
    }

    private async getOrCreateUsageRow(metricName: string, periodDate: string): Promise<TenantUsageEntity> {
        let row = await this.usageRepository.findOne({
            where: { metricName, periodDate }
        });

        if (!row) {
            row = this.usageRepository.createTenantContext({
                metricName,
                periodDate,
                currentUsage: 0,
                limitValue: null
            });
        }

        return row;
    }

    async increment(metricName: string, amount = 1): Promise<number> {
        if (amount <= 0) {
            return this.getUsage(metricName);
        }

        const periodDate = this.getTodayDate();
        let row = await this.getOrCreateUsageRow(metricName, periodDate);
        row.currentUsage += amount;
        row = await this.usageRepository.saveTenantContext(row);

        return row.currentUsage;
    }

    async decrement(metricName: string, amount = 1): Promise<number> {
        if (amount <= 0) {
            return this.getUsage(metricName);
        }

        const periodDate = this.getTodayDate();
        let row = await this.getOrCreateUsageRow(metricName, periodDate);
        row.currentUsage = Math.max(0, row.currentUsage - amount);
        row = await this.usageRepository.saveTenantContext(row);

        return row.currentUsage;
    }

    async getUsage(metricName: string, periodDate?: string): Promise<number> {
        const date = periodDate ?? this.getTodayDate();
        const row = await this.usageRepository.findOne({
            where: { metricName, periodDate: date }
        });

        return row?.currentUsage ?? 0;
    }
}
