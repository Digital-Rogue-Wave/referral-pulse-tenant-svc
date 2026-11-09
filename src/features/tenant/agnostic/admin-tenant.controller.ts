import { Controller, Post, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminCreateTenantDto, AdminLockTenantDto, AdminTenantCreatedResponse, TenantResponse, SuspendTenantDto } from '@domains/tenant';
import { CurrentUser } from '@common/auth/current-user.decorator';
import type { IAuthenticatedUser } from '@app/types';
import { AllowServices, PlatformAdmin } from '@common/auth/require-permission.decorator';
import { ServiceCapability } from '@common/auth/authz/keto-tuples';

import { AdminTenantService } from '../admin-tenant.service';
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
    constructor(
        private readonly tenantService: TenantService,
        private readonly adminTenantService: AdminTenantService
    ) {}

    /** Platform admins only: the `tenant.suspend` service capability does not cover creation. */
    @Post()
    @AllowServices()
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Create a tenant from the platform console and invite its Owner by email' })
    @ApiCreatedResponse({ type: AdminTenantCreatedResponse })
    async create(@Body() dto: AdminCreateTenantDto, @CurrentUser() user: IAuthenticatedUser): Promise<AdminTenantCreatedResponse> {
        return await this.adminTenantService.create(dto, user.userId);
    }

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

    @Post(':id/lock')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Lock a tenant (platform admin); optional lock_until makes it expire' })
    @ApiOkResponse({ type: TenantResponse })
    async lock(@Param('id') id: string, @Body() dto: AdminLockTenantDto, @CurrentUser() user: IAuthenticatedUser): Promise<TenantResponse> {
        return await this.tenantService.lockAsAdmin(id, dto.reason, dto.lockUntil ? new Date(dto.lockUntil) : null, user.userId);
    }

    @Post(':id/unlock')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Unlock a tenant (platform admin)' })
    @ApiOkResponse({ type: TenantResponse })
    async unlock(@Param('id') id: string, @CurrentUser() user: IAuthenticatedUser): Promise<TenantResponse> {
        return await this.tenantService.unlockAsAdmin(id, user.userId);
    }
}
