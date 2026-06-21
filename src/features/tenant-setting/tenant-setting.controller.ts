import { Controller, Get, Put, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOkResponse, ApiBody } from '@nestjs/swagger';

import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation, KetoResource } from '@common/auth/keto.constants';
import { Idempotent, IdempotencyScope } from '@common/idempotency';

import { UpdateTenantSettingDto, TenantSettingResponse } from '@domains/tenant-setting';

import { TenantSettingService } from './tenant-setting.service';

/**
 * Tenant settings — a per-tenant singleton, so the surface is read-current + upsert (no list/by-id/delete).
 * Tenant is resolved from the authenticated token, not a header.
 */
@ApiTags('Tenant Settings')
@ApiBearerAuth()
@Controller({ path: 'tenant-settings', version: '1' })
export class TenantSettingController {
    constructor(private readonly tenantSettingService: TenantSettingService) {}

    @ApiOkResponse({ description: 'Current tenant settings', type: TenantSettingResponse })
    @RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.READ })
    @HttpCode(HttpStatus.OK)
    @Get('current')
    async findCurrent(): Promise<TenantSettingResponse | null> {
        return this.tenantSettingService.findByTenant();
    }

    @ApiBody({ type: UpdateTenantSettingDto })
    @ApiOkResponse({ description: 'Tenant settings saved', type: TenantSettingResponse })
    @RequirePermission({ namespace: KetoNamespace.TENANT, object: KetoResource.SETTINGS, relation: KetoRelation.UPDATE })
    @HttpCode(HttpStatus.OK)
    @Put()
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    async upsert(@Body() dto: UpdateTenantSettingDto): Promise<TenantSettingResponse> {
        return this.tenantSettingService.upsert(dto);
    }
}
