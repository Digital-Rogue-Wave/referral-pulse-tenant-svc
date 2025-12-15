import { Controller, Get, Post, Body, Param, Delete, HttpStatus, HttpCode, Put } from '@nestjs/common';
import { ApiTags, ApiResponse, ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { TenantSettingService } from './tenant-setting.service';
import { CreateTenantSettingDto } from './dto/create-tenant-setting.dto';
import { UpdateTenantSettingDto } from './dto/update-tenant-setting.dto';
import { TenantSettingEntity } from './tenant-setting.entity';
import { NullableType } from '@mod/types/nullable.type';
import { KetoNamespace, KetoPermission } from '@mod/common/auth/keto.constants';
import { RequirePermission } from '@mod/common/auth/keto.guard';

@ApiTags('Tenant Settings')
@Controller({ path: 'tenant-settings', version: '1' })
export class TenantSettingController {
    constructor(private readonly tenantSettingService: TenantSettingService) {}

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
