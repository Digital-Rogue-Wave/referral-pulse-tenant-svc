import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiHeader, ApiBody } from '@nestjs/swagger';

import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation, KetoResource } from '@common/auth/keto.constants';
import { Paginate, PaginateQuery, Paginated, ApiPaginationQuery } from '@common/nestjs-prisma-pagination';
import { Idempotent, IdempotencyScope } from '@common/idempotency';

import { CreateTenantSettingDto, UpdateTenantSettingDto, TenantSettingResponse } from '@domains/tenant-setting';

import { TenantSettingService } from './tenant-setting.service';
import { TENANT_SETTING_PAGINATE_CONFIG } from './tenant-setting.pagination';

@ApiTags('Tenant Settings')
@ApiHeader({
    name: 'x-tenant-id',
    required: true,
    description: 'Tenant ID header',
    schema: { type: 'string' }
})
@Controller({ path: 'tenant-settings', version: '1' })
@ApiBearerAuth()
export class TenantSettingController {
    constructor(private readonly tenantSettingService: TenantSettingService) {}

    @ApiBody({ type: CreateTenantSettingDto })
    @ApiCreatedResponse({
        description: 'Tenant setting created successfully',
        type: TenantSettingResponse
    })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        object: KetoResource.SETTINGS,
        relation: KetoRelation.CREATE
    })
    @HttpCode(HttpStatus.CREATED)
    @Post()
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
    async create(@Body() dto: CreateTenantSettingDto): Promise<TenantSettingResponse> {
        return this.tenantSettingService.create(dto);
    }

    @ApiPaginationQuery(TENANT_SETTING_PAGINATE_CONFIG)
    @ApiOkResponse({
        description: 'List of tenant settings',
        type: TenantSettingResponse,
        isArray: true
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get()
    async findAll(@Paginate() query: PaginateQuery): Promise<Paginated<TenantSettingResponse>> {
        return this.tenantSettingService.findAll(query);
    }

    @ApiOkResponse({
        description: 'Current tenant setting',
        type: TenantSettingResponse
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get('current')
    async findCurrent(): Promise<TenantSettingResponse | null> {
        return this.tenantSettingService.findByTenant();
    }

    @ApiOkResponse({
        description: 'Tenant setting details',
        type: TenantSettingResponse
    })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get(':id')
    async findOne(@Param('id') id: string): Promise<TenantSettingResponse> {
        return this.tenantSettingService.findById(id);
    }

    @ApiBody({ type: UpdateTenantSettingDto })
    @ApiOkResponse({
        description: 'Tenant setting updated successfully',
        type: TenantSettingResponse
    })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        object: KetoResource.SETTINGS,
        relation: KetoRelation.UPDATE
    })
    @HttpCode(HttpStatus.OK)
    @Put(':id')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async update(@Param('id') id: string, @Body() dto: UpdateTenantSettingDto): Promise<TenantSettingResponse> {
        return this.tenantSettingService.update(id, dto);
    }

    @ApiOkResponse({ description: 'Tenant setting deleted successfully' })
    @RequirePermission({
        namespace: KetoNamespace.TENANT,
        object: KetoResource.SETTINGS,
        relation: KetoRelation.DELETE
    })
    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete(':id')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async delete(@Param('id') id: string): Promise<void> {
        await this.tenantSettingService.delete(id);
    }
}
