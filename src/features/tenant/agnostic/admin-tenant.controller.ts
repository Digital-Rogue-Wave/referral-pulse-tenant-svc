import { Controller, Post, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { TenantResponse, SuspendTenantDto } from '@domains/tenant';

import { TenantService } from '../tenant.service';

@ApiTags('Admin - Tenants')
@ApiBearerAuth()
@Controller({ path: 'admin/tenants', version: '1' })
// TODO: Add admin guards: @UseGuards(JwtAuthGuard, AdminGuard)
export class AdminTenantController {
    constructor(private readonly tenantService: TenantService) {}

    @Post(':id/suspend')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Suspend a tenant' })
    @ApiOkResponse({ type: TenantResponse })
    async suspend(@Param('id') id: string, @Body() dto: SuspendTenantDto): Promise<TenantResponse> {
        return await this.tenantService.suspend(id, dto.reason);
    }

    @Post(':id/unsuspend')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Unsuspend a tenant' })
    @ApiOkResponse({ type: TenantResponse })
    async unsuspend(@Param('id') id: string): Promise<TenantResponse> {
        return await this.tenantService.unsuspend(id);
    }
}
