import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { UsageUpdateDto } from '@domains/billing';

import { UsageTrackerService } from './usage-tracker.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { PlanLimitService } from './plan-limit.service';

@Controller('internal/tenants')
export class UsageInternalController {
    constructor(
        private readonly usageTracker: UsageTrackerService,
        private readonly planLimitService: PlanLimitService,
        private readonly tenantContext: TenantContextService
    ) {}

    @HttpCode(HttpStatus.OK)
    @Post(':tenantId/usage/increment')
    async incrementUsage(
        @Param('tenantId') tenantId: string,
        @Body() dto: UsageUpdateDto
    ): Promise<{ metric: string; currentUsage: number; periodDate: string }> {
        this.tenantContext.set('tenantId', tenantId);
        await this.planLimitService.enforceLimit(tenantId, dto.metric, dto.amount ?? 1);
        const current = await this.usageTracker.increment(dto.metric, dto.amount ?? 1);
        const periodDate = new Date().toISOString().slice(0, 10);
        return { metric: dto.metric, currentUsage: current, periodDate };
    }

    @HttpCode(HttpStatus.OK)
    @Post(':tenantId/usage/decrement')
    async decrementUsage(
        @Param('tenantId') tenantId: string,
        @Body() dto: UsageUpdateDto
    ): Promise<{ metric: string; currentUsage: number; periodDate: string }> {
        this.tenantContext.set('tenantId', tenantId);
        const current = await this.usageTracker.decrement(dto.metric, dto.amount ?? 1);
        const periodDate = new Date().toISOString().slice(0, 10);
        return { metric: dto.metric, currentUsage: current, periodDate };
    }
}
