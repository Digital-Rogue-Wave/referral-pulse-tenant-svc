import { Controller, Get, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { AllowServices } from '@common/auth/require-permission.decorator';
import { WidgetTokenSecretDto } from '@domains/tenant';

import { WidgetSecretService } from './widget-secret.service';

/**
 * A tenant's widget-token secret (API Contract §4.1).
 *
 * The widget identity token is "a server-generated JWT from the client's backend (signed with a
 * shared secret)", and Event Ingestion verifies it before rendering anything. A shared secret has
 * two holders and the v5 suite describes neither's storage, so this endpoint is the proposal in
 * `my-docs/cross-service-requirements.md` §1.11 and CHANGELOG D-41 — modelled on the email-tracking
 * key this service already serves, for the same reason: two services must agree on one value, so it
 * lives in neither.
 *
 * Service tokens only, under its own capability. The Owner reads the same secret through the tenant-scoped
 * `GET /v1/tenants/widget-secret` (Owner only, audited); this route serves any tenant, so it stays
 * service-only. Within an hour of a rotation the previous secret comes too (US1.5.4 F3).
 *
 * `tenantId` comes from the path rather than the caller's token because the caller is ingestion,
 * whose service token carries no tenant — the same shape as the other internal per-tenant reads.
 */
@ApiTags('Internal')
@ApiBearerAuth()
@Controller({ path: 'internal/tenants', version: '1' })
export class InternalWidgetSecretController {
    constructor(private readonly widgetSecrets: WidgetSecretService) {}

    @ApiOperation({ summary: 'The secret a tenant’s widget identity tokens are signed and verified with' })
    @ApiOkResponse({ type: WidgetTokenSecretDto })
    @AllowServices(ServiceCapability.WIDGET_SECRET_READ)
    @HttpCode(HttpStatus.OK)
    @Get(':tenantId/widget-token-secret')
    async widgetTokenSecret(@Param('tenantId') tenantId: string): Promise<WidgetTokenSecretDto> {
        return await this.widgetSecrets.forService(tenantId);
    }
}
