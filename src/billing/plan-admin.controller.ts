import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Put,
    UseGuards,
    UseInterceptors
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';
import { KetoGuard, RequirePermission } from '@mod/common/auth/keto.guard';
import { KetoNamespace, KetoRelation } from '@mod/common/auth/keto.constants';
import { PlanService } from './plan.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlanEntity } from './plan.entity';
import { PlanDto } from './dto/plan.dto';
import { InjectMapper, MapInterceptor } from '@automapper/nestjs';
import { Mapper } from '@automapper/core';
import { PaginatedDto } from '@mod/common/serialization/paginated.dto';
import { ApiPaginationQuery, Paginate, PaginateQuery } from 'nestjs-paginate';
import { planPaginationConfig } from './config/plan-pagination.config';
import { NullableType } from '@mod/types/nullable.type';

@ApiTags('Billing Plans (Admin)')
@ApiBearerAuth()
@ApiHeader({
    name: 'tenant-id',
    required: true,
    description: 'Tenant-Id header',
    schema: { type: 'string' }
})
@Controller({ path: 'billings/admin/plans', version: '1' })
@UseGuards(JwtAuthGuard, KetoGuard)
export class PlanAdminController {
    constructor(
        private readonly planService: PlanService,
        @InjectMapper() private readonly mapper: Mapper
    ) {}

    @ApiBody({ type: CreatePlanDto })
    @ApiCreatedResponse({ description: 'Plan created successfully', type: PlanDto })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.MANAGE_PLANS,
        objectParam: 'tenantId',
        allowServiceTokens: true
    })
    @UseInterceptors(MapInterceptor(PlanEntity, PlanDto))
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async create(@Body() dto: CreatePlanDto): Promise<PlanEntity> {
        return this.planService.create(dto);
    }

    @ApiPaginationQuery(planPaginationConfig)
    @ApiOkResponse({ description: 'List of plans', type: PlanDto, isArray: true })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.MANAGE_PLANS,
        objectParam: 'tenantId',
        allowServiceTokens: true
    })
    @UseInterceptors(MapInterceptor(PlanEntity, PlanDto, { isArray: true }))
    @HttpCode(HttpStatus.OK)
    @Get()
    async listPlans(@Paginate() query: PaginateQuery): Promise<PaginatedDto<PlanEntity, PlanDto>> {
        const plans = await this.planService.findAllPaginated(query);
        return new PaginatedDto<PlanEntity, PlanDto>(this.mapper, plans, PlanEntity, PlanDto);
    }

    @ApiOkResponse({ description: 'Plan details', type: PlanDto })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.MANAGE_PLANS,
        objectParam: 'tenantId',
        allowServiceTokens: true
    })
    @UseInterceptors(MapInterceptor(PlanEntity, PlanDto))
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<NullableType<PlanEntity>> {
        return this.planService.findOne({ id });
    }

    @ApiBody({ type: UpdatePlanDto })
    @ApiOkResponse({ description: 'Plan updated successfully', type: PlanDto })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.MANAGE_PLANS,
        objectParam: 'tenantId',
        allowServiceTokens: true
    })
    @UseInterceptors(MapInterceptor(PlanEntity, PlanDto))
    @HttpCode(HttpStatus.OK)
    @Put(':id')
    async update(@Param('id') id: string, @Body() dto: UpdatePlanDto): Promise<PlanEntity> {
        return this.planService.update(id, dto);
    }

    @ApiOkResponse({ description: 'Plan soft-deleted successfully' })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        relation: KetoRelation.MANAGE_PLANS,
        objectParam: 'tenantId',
        allowServiceTokens: true
    })
    @HttpCode(HttpStatus.OK)
    @Delete(':id')
    async delete(@Param('id') id: string): Promise<void> {
        await this.planService.softDelete(id);
    }
}
