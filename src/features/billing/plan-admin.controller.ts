import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdmin } from '@common/auth/require-permission.decorator';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { CursorPage, ListQueryDto } from '@common/http-contract/cursor-page';

import { CreatePlanDto, UpdatePlanDto, PlanDto } from '@domains/billing';

import { PlanService } from './plan.service';
import { NullableType } from '@app/types';

@ApiTags('Billing Plans (Admin)')
@ApiBearerAuth()
@PlatformAdmin()
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
    @HttpCode(HttpStatus.CREATED)
    @Post()
    async create(@Body() dto: CreatePlanDto): Promise<PlanDto> {
        return this.planService.create(dto);
    }

    @ApiOkResponse({ description: 'A page of plans, newest first (inactive included)', type: CursorPage })
    @HttpCode(HttpStatus.OK)
    @Get()
    async listPlans(@Query() query: ListQueryDto): Promise<CursorPage<PlanDto>> {
        return this.planService.findPage(query, true);
    }

    @ApiOkResponse({ description: 'Plan details', type: PlanDto })
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<NullableType<PlanDto>> {
        return this.planService.findOne({ id });
    }

    @ApiBody({ type: UpdatePlanDto })
    @ApiOkResponse({ description: 'Plan updated successfully', type: PlanDto })
    @HttpCode(HttpStatus.OK)
    @Put(':id')
    async update(@Param('id') id: string, @Body() dto: UpdatePlanDto): Promise<PlanDto> {
        return this.planService.update(id, dto);
    }

    @ApiOkResponse({ description: 'Plan soft-deleted successfully' })
    @HttpCode(HttpStatus.OK)
    @Delete(':id')
    async delete(@Param('id') id: string): Promise<void> {
        await this.planService.softDelete(id);
    }
}
