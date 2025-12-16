import { Controller, Get, Post, Body, Param, Delete, HttpStatus, HttpCode, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiResponse, ApiBody, ApiOkResponse, ApiHeader, ApiBearerAuth } from '@nestjs/swagger';
import { AwareTenantSettingService } from './aware-tenant-setting.service';
import { CreateTenantSettingDto } from '../dto/create-tenant-setting.dto';
import { UpdateTenantSettingDto } from '../dto/update-tenant-setting.dto';
import { TenantSettingEntity } from '../tenant-setting.entity';
import { NullableType } from '@mod/types/nullable.type';
import { KetoNamespace, KetoPermission } from '@mod/common/auth/keto.constants';
import { RequirePermission } from '@mod/common/auth/keto.guard';
import { JwtAuthGuard } from '@mod/common/auth/jwt-auth.guard';

@ApiTags('Tenant Settings')
@ApiHeader({
    name: 'tenant-id',
    required: true,
    description: 'Tenant-Id header',
    schema: { type: 'string' }
})
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'tenant-settings', version: '1' })
export class AwareTenantSettingController {
    constructor(private readonly tenantSettingService: AwareTenantSettingService) {}

    @Post()
    @ApiBody({ type: CreateTenantSettingDto })
    @ApiResponse({ status: HttpStatus.CREATED, description: 'Created successfully' })
    @HttpCode(HttpStatus.CREATED)
    async create(@Body() createDto: CreateTenantSettingDto): Promise<TenantSettingEntity> {
        return await this.tenantSettingService.create(createDto);
    }

    @Get()
    @ApiOkResponse({ description: 'List of tenant settings', type: TenantSettingEntity, isArray: true })
    @HttpCode(HttpStatus.OK)
    async findAll(): Promise<TenantSettingEntity[]> {
        return await this.tenantSettingService.findAll();
    }

    @Get(':id')
    @ApiOkResponse({ description: 'Tenant setting', type: TenantSettingEntity })
    @HttpCode(HttpStatus.OK)
    async findOne(@Param('id') id: string): Promise<NullableType<TenantSettingEntity>> {
        return await this.tenantSettingService.findOne({ id });
    }

    @Put(':id')
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoPermission.UPDATE, objectParam: 'id' })
    @ApiBody({ type: UpdateTenantSettingDto })
    @ApiOkResponse({ description: 'Updated successfully', type: TenantSettingEntity })
    @HttpCode(HttpStatus.OK)
    async update(@Param('id') id: string, @Body() updateDto: UpdateTenantSettingDto): Promise<TenantSettingEntity> {
        return await this.tenantSettingService.update(id, updateDto);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.OK)
    async remove(@Param('id') id: string): Promise<void> {
        return await this.tenantSettingService.remove(id);
    }
}
