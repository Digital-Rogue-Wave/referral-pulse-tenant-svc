import { Controller, Get, Post, Body, Param, Delete, Put } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantEntity } from './tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { NullableType } from '@mod/types/nullable.type';
import { DeleteResult } from 'typeorm';

@Controller({ path: 'tenants', version: '1' })
export class TenantController {
    constructor(private readonly tenantService: TenantService) {}

    @Post()
    async create(@Body() createTenantDto: CreateTenantDto): Promise<TenantEntity> {
        return await this.tenantService.create(createTenantDto);
    }

    @Get()
    async findAll() {
        return await this.tenantService.findAll();
    }

    @Get(':id')
    async findOne(@Param('id') id: string): Promise<NullableType<TenantEntity>> {
        return await this.tenantService.findOne(id);
    }

    @Put(':id')
    async update(@Param('id') id: string, @Body() updateTenantDto: UpdateTenantDto) {
        return await this.tenantService.update(id, updateTenantDto);
    }

    @Delete(':id')
    async remove(@Param('id') id: string): Promise<DeleteResult> {
        return await this.tenantService.remove(id);
    }
}
