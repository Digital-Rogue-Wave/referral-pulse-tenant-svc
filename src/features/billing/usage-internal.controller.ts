import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { UsageUpdateDto } from '@domains/billing';

import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation } from '@common/auth/keto.constants';

import { UsageTrackerService } from './usage-tracker.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { PlanLimitService } from './plan-limit.service';

/**
 * Internal service-to-service usage metering.
 *
 * Both routes take the target tenant from the path and write to that tenant's
 * billing counters, so the permission check is bound to that same path param via
 * `objectParam` — a caller must hold `tenants:<tenantId>#update`, not merely
 * `update` on some tenant. Without `objectParam` the guard falls back to the
 * caller's own tenant context, which would authorize a caller for a tenant it
 * has no rights over. Service tokens (the intended callers) bypass Keto.
 */
@ApiTags('Internal')
@ApiBearerAuth()
@Controller('internal/tenants')
export class UsageInternalController {
    constructor(
        private readonly usageTracker: UsageTrackerService,
        private readonly planLimitService: PlanLimitService,
        private readonly tenantContext: TenantContextService
    ) {}

    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.UPDATE,
        objectParam: 'tenantId',
        allowServiceTokens: true
    })
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

    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.UPDATE,
        objectParam: 'tenantId',
        allowServiceTokens: true
    })
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
