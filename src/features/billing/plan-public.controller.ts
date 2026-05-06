import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/auth/public.decorator';

import { PlanDto } from '@domains/billing';

import { PlanService } from './plan.service';

@ApiTags('Billing Plans')
@Controller({ path: 'billings/plans', version: '1' })
export class PlanPublicController {
    constructor(private readonly planService: PlanService) {}

    @Public()
    @ApiOkResponse({
        description: 'List of public plans',
        type: PlanDto,
        isArray: true,
    })
    @HttpCode(HttpStatus.OK)
    @Get()
    async listPublicPlans(): Promise<PlanDto[]> {
        return this.planService.getPublicPlansCached();
    }
}
