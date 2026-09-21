import { Controller, Post, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { TenantResponse, SuspendTenantDto } from '@domains/tenant';
import { AllowServices, PlatformAdmin } from '@common/auth/require-permission.decorator';
import { ServiceCapability } from '@common/auth/authz/keto-tuples';

import { TenantService } from '../tenant.service';

/**
 * Platform-admin tenant operations (cross-tenant — they act on the `:id` in the path, not the caller's
 * tenant). Only a platform administrator (`platform:referralai#admin`) or a service granted the
 * `tenant.suspend` capability may call them; no tenant role, however high, reaches another tenant.
 */
@ApiTags('Admin - Tenants')
@ApiBearerAuth()
@PlatformAdmin()
@AllowServices(ServiceCapability.TENANT_SUSPEND)
@Controller({ path: 'admin/tenants', version: '1' })
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
