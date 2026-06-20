import { Controller, Post, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { TenantResponse, SuspendTenantDto } from '@domains/tenant';
import { Idempotent, IdempotencyScope } from '@common/idempotency';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation } from '@common/auth/keto.constants';

import { TenantService } from '../tenant.service';

/**
 * Platform-admin tenant operations (cross-tenant). Restricted to platform/system callers:
 * a service token (client_credentials) or a principal holding the Keto tenant:update relation.
 */
@ApiTags('Admin - Tenants')
@ApiBearerAuth()
@RequirePermission({ namespace: KetoNamespace.TENANT, relation: KetoRelation.UPDATE, allowServiceTokens: true })
@Controller({ path: 'admin/tenants', version: '1' })
export class AdminTenantController {
    constructor(private readonly tenantService: TenantService) {}

    @Post(':id/suspend')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Suspend a tenant' })
    @ApiOkResponse({ type: TenantResponse })
    async suspend(@Param('id') id: string, @Body() dto: SuspendTenantDto): Promise<TenantResponse> {
        return await this.tenantService.suspend(id, dto.reason);
    }

    @Post(':id/unsuspend')
    @Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Unsuspend a tenant' })
    @ApiOkResponse({ type: TenantResponse })
    async unsuspend(@Param('id') id: string): Promise<TenantResponse> {
        return await this.tenantService.unsuspend(id);
    }
}
