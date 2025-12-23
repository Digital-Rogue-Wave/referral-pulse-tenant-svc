import { Controller, Post, Body, Param, HttpCode, HttpStatus, UseInterceptors } from '@nestjs/common';
import { AgnosticTenantService } from './agnostic-tenant.service';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MapInterceptor } from '@automapper/nestjs';
import { TenantDto } from '../dto/tenant/tenant.dto';
import { TenantEntity } from '../tenant.entity';
import { SuspendTenantDto } from '../dto/tenant/suspend-tenant.dto';

@ApiTags('Admin - Tenants')
@ApiBearerAuth()
@Controller({ path: 'admin/tenants', version: '1' })
//@UseGuards(JwtAuthGuard, RolesGuard) // Assuming there will be admin guards
export class AdminTenantController {
    constructor(private readonly tenantService: AgnosticTenantService) {}

    @Post(':id/suspend')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Suspend a tenant' })
    @ApiOkResponse({ type: TenantDto })
    @UseInterceptors(MapInterceptor(TenantEntity, TenantDto))
    async suspend(@Param('id') id: string, @Body() dto: SuspendTenantDto): Promise<TenantEntity> {
        return await this.tenantService.suspend(id, dto.reason);
    }

    @Post(':id/unsuspend')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Unsuspend a tenant' })
    @ApiOkResponse({ type: TenantDto })
    @UseInterceptors(MapInterceptor(TenantEntity, TenantDto))
    async unsuspend(@Param('id') id: string): Promise<TenantEntity> {
        return await this.tenantService.unsuspend(id);
    }
}
