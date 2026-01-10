import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { UsageTrackerService } from './usage-tracker.service';
import { UsageUpdateDto } from './dto/usage-update.dto';
import { Utils } from '@mod/common/utils/utils';
import { ClsService } from 'nestjs-cls';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';
import { PlanLimitService } from './plan-limit.service';

@Controller('internal/tenants')
export class UsageInternalController {
    constructor(
        private readonly usageTracker: UsageTrackerService,
        private readonly planLimitService: PlanLimitService,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    @HttpCode(HttpStatus.OK)
    @Post(':tenantId/usage/increment')
    async incrementUsage(
        @Param('tenantId') tenantId: string,
        @Body() dto: UsageUpdateDto
    ): Promise<{ metric: string; currentUsage: number; periodDate: string }> {
        const validated = await Utils.validateDtoOrFail(UsageUpdateDto, dto);
        this.cls.set('tenantId', tenantId);
        await this.planLimitService.enforceLimit(tenantId, validated.metric, validated.amount ?? 1);
        const current = await this.usageTracker.increment(validated.metric, validated.amount ?? 1);
        const periodDate = new Date().toISOString().slice(0, 10);
        return { metric: validated.metric, currentUsage: current, periodDate };
    }

    @HttpCode(HttpStatus.OK)
    @Post(':tenantId/usage/decrement')
    async decrementUsage(
        @Param('tenantId') tenantId: string,
        @Body() dto: UsageUpdateDto
    ): Promise<{ metric: string; currentUsage: number; periodDate: string }> {
        const validated = await Utils.validateDtoOrFail(UsageUpdateDto, dto);
        this.cls.set('tenantId', tenantId);
        const current = await this.usageTracker.decrement(validated.metric, validated.amount ?? 1);
        const periodDate = new Date().toISOString().slice(0, 10);
        return { metric: validated.metric, currentUsage: current, periodDate };
    }
}
