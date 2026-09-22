import { Injectable } from '@nestjs/common';

import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { UsageCounterService } from './usage-counter.service';

/**
 * Usage metering for the tenant in the request context, on the durable `usage_counters`. Limits are not
 * checked here; metering that must respect the plan goes through `PlanLimitService.consume`.
 */
@Injectable()
export class UsageTrackerService {
    constructor(
        private readonly tenantContext: TenantContextService,
        private readonly counters: UsageCounterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(UsageTrackerService.name);
    }

    async increment(metricName: string, amount = 1): Promise<number> {
        const tenantId = this.tenantContext.getTenantId();
        if (!tenantId || amount <= 0) {
            return tenantId ? this.counters.get(tenantId, metricName) : 0;
        }
        return (await this.counters.consume(tenantId, metricName, amount, null)) ?? 0;
    }

    async decrement(metricName: string, amount = 1): Promise<number> {
        const tenantId = this.tenantContext.getTenantId();
        if (!tenantId || amount <= 0) {
            return tenantId ? this.counters.get(tenantId, metricName) : 0;
        }
        return this.counters.release(tenantId, metricName, amount);
    }

    async getUsage(metricName: string): Promise<number> {
        const tenantId = this.tenantContext.getTenantId();
        return tenantId ? this.counters.get(tenantId, metricName) : 0;
    }
}
