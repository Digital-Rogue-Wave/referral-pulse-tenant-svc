import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { IAuthenticatedUser } from '@app/types';
import { CurrentUser } from '@common/auth/current-user.decorator';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { TenantSettingsResponse, UpdateTenantSettingsDto } from '@domains/tenant';

import { TenantService } from '../tenant.service';

/**
 * The Owner settings — v5.1's `PATCH /v1/tenant/settings` (E1 decision D8): invitation channel (R-PRT-02),
 * raw-data retention (6–36 months) and the payout verification threshold. JSON through the global
 * validation pipe; `tenants:write` is Owner-only and live-checked; every change is one audited
 * `tenant.updated`.
 */
@ApiTags('Tenant settings')
@ApiBearerAuth()
@Controller({ path: 'tenant/settings', version: '1' })
export class TenantSettingsController {
    constructor(private readonly tenantService: TenantService) {}

    @ApiOperation({ summary: 'The Owner settings that apply, and whether the invitation channel is explicit or the platform default' })
    @ApiOkResponse({ type: TenantSettingsResponse })
    @RequirePermission('tenants:read')
    @HttpCode(HttpStatus.OK)
    @Get()
    async get(): Promise<TenantSettingsResponse> {
        return this.tenantService.getSettings();
    }

    @ApiOperation({ summary: 'Change the Owner settings (Owner only)' })
    @ApiOkResponse({ type: TenantSettingsResponse })
    @RequirePermission('tenants:write')
    @HttpCode(HttpStatus.OK)
    @Patch()
    async update(@Body() dto: UpdateTenantSettingsDto, @CurrentUser() user: IAuthenticatedUser): Promise<TenantSettingsResponse> {
        return this.tenantService.updateSettings(dto, user);
    }
}
