import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { IAuthenticatedUser } from '@app/types';
import { CurrentUser } from '@common/auth/current-user.decorator';
import { RequirePermission } from '@common/auth/require-permission.decorator';
import { TenantRecordResponse, WidgetSigningSecretsResponse } from '@domains/tenant';

import { TenantService } from '../tenant.service';
import { WidgetSecretService } from '../widget-secret.service';

/**
 * v5.2 API §3.17 "Tenant settings and widget signing secret": the tenant record and the widget signing
 * secrets. The settings PATCH lives in `TenantSettingsController` under the same path.
 */
@ApiTags('Tenant settings')
@ApiBearerAuth()
@Controller({ path: 'tenant', version: '1' })
export class TenantRecordController {
    constructor(
        private readonly tenantService: TenantService,
        private readonly widgetSecrets: WidgetSecretService
    ) {}

    @ApiOperation({ summary: 'The tenant record: name, slug, plan, verification status, billing country, retention, data region' })
    @ApiOkResponse({ type: TenantRecordResponse })
    @RequirePermission('tenant:read')
    @HttpCode(HttpStatus.OK)
    @Get()
    async get(): Promise<TenantRecordResponse> {
        return this.tenantService.getRecord();
    }

    /** US1.5.5: the one or two active secrets with their `kid`, in full. Owner only, checked live; every read is audited. */
    @ApiOperation({ summary: 'The active widget signing secrets with their kid' })
    @ApiOkResponse({ type: WidgetSigningSecretsResponse })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.OK)
    @Get('widget-secret')
    async getWidgetSecret(@CurrentUser() user: IAuthenticatedUser): Promise<WidgetSigningSecretsResponse> {
        return this.widgetSecrets.reveal(user.tenantId, user.userId);
    }

    /** US1.5.5: a new secret under a new `kid`; the previous one keeps verifying for 7 days. Audited. */
    @ApiOperation({ summary: 'Mint a new widget signing secret; the previous one stays valid for 7 days' })
    @ApiOkResponse({ type: WidgetSigningSecretsResponse })
    @RequirePermission('api_keys:manage')
    @HttpCode(HttpStatus.OK)
    @Post('widget-secret/rotate')
    async rotateWidgetSecret(@CurrentUser() user: IAuthenticatedUser): Promise<WidgetSigningSecretsResponse> {
        return this.widgetSecrets.rotate(user.tenantId, user.userId);
    }
}
