import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation, KetoResource } from '@common/auth/keto.constants';
import { Idempotent, IdempotencyScope } from '@common/idempotency';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { Paginate, PaginateQuery, Paginated, ApiPaginationQuery, FilterOperator } from '@common/nestjs-prisma-pagination';

import { CreatePlanDto, UpdatePlanDto, PlanDto } from '@domains/billing';

import { PlanService } from './plan.service';
import { NullableType } from '@app/types';

@ApiTags('Billing Plans (Admin)')
@ApiBearerAuth()
@ApiHeader({
    name: 'tenant-id',
    required: true,
    description: 'Tenant-Id header',
    schema: { type: 'string' }
})
@Controller({ path: 'billings/admin/plans', version: '1' })
export class PlanAdminController {
    constructor(
        private readonly planService: PlanService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(PlanAdminController.name);
    }

    @ApiBody({ type: CreatePlanDto })
    @ApiCreatedResponse({
        description: 'Plan created successfully',
        type: PlanDto
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.PLANS, relation: KetoRelation.CREATE })
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async create(@Body() dto: CreatePlanDto): Promise<PlanDto> {
        return this.planService.create(dto);
    }

    @ApiPaginationQuery({
        sortableColumns: ['name', 'createdAt', 'isActive'],
        filterableColumns: {
            name: [FilterOperator.EQ, FilterOperator.CONTAINS],
            isActive: [FilterOperator.EQ]
        },
        searchableColumns: ['name'],
        defaultLimit: 20,
        maxLimit: 100
    })
    @ApiOkResponse({ description: 'List of plans', type: PlanDto, isArray: true })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.PLANS, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get()
    async listPlans(@Paginate() query: PaginateQuery<PlanDto>): Promise<Paginated<PlanDto>> {
        return this.planService.findAllPaginated(query);
    }

    @ApiOkResponse({ description: 'Plan details', type: PlanDto })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.PLANS, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<NullableType<PlanDto>> {
        return this.planService.findOne({ id });
    }

    @ApiBody({ type: UpdatePlanDto })
    @ApiOkResponse({ description: 'Plan updated successfully', type: PlanDto })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.PLANS, relation: KetoRelation.UPDATE })
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    @HttpCode(HttpStatus.OK)
    @Put(':id')
    async update(@Param('id') id: string, @Body() dto: UpdatePlanDto): Promise<PlanDto> {
        return this.planService.update(id, dto);
    }

    @ApiOkResponse({ description: 'Plan soft-deleted successfully' })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.PLANS, relation: KetoRelation.DELETE })
    @HttpCode(HttpStatus.OK)
    @Delete(':id')
    async delete(@Param('id') id: string): Promise<void> {
        await this.planService.softDelete(id);
    }
}
