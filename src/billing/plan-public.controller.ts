import { Controller, Get, HttpCode, HttpStatus, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@mod/common/auth/jwt-auth.guard';
import { PlanService } from './plan.service';
import { PlanEntity } from './plan.entity';
import { PlanDto } from './dto/plan.dto';
import { MapInterceptor } from '@automapper/nestjs';

@ApiTags('Billing Plans')
@Controller({ path: 'billings/plans', version: '1' })
export class PlanPublicController {
    constructor(private readonly planService: PlanService) {}

    @Public()
    @ApiOkResponse({ description: 'List of public plans', type: PlanDto, isArray: true })
    @UseInterceptors(MapInterceptor(PlanEntity, PlanDto, { isArray: true }))
    @HttpCode(HttpStatus.OK)
    @Get()
    async listPublicPlans(): Promise<PlanEntity[]> {
        return this.planService.getPublicPlansCached();
    }
}
