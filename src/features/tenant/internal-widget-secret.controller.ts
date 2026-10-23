import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, ServiceUnavailableException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { AllowServices } from '@common/auth/require-permission.decorator';
import { DatabaseService } from '@app/database/database.service';
import { WidgetTokenSecretDto } from '@domains/tenant';

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
 * Service tokens only, under its own capability. There is deliberately **no dashboard route**: this
 * value signs identities, and an operator session that could read another tenant's secret could mint
 * widget tokens for their participants. Handing it to the tenant who must sign with it is a separate,
 * API-key-shaped problem (shown once, rotatable) and is not built here.
 *
 * `tenantId` comes from the path rather than the caller's token because the caller is ingestion,
 * whose service token carries no tenant — the same shape as the other internal per-tenant reads.
 */
@ApiTags('Internal')
@ApiBearerAuth()
@Controller({ path: 'internal/tenants', version: '1' })
export class InternalWidgetSecretController {
    constructor(private readonly prisma: DatabaseService) {}

    @ApiOperation({ summary: 'The secret a tenant’s widget identity tokens are signed and verified with' })
    @ApiOkResponse({ type: WidgetTokenSecretDto })
    @AllowServices(ServiceCapability.WIDGET_SECRET_READ)
    @HttpCode(HttpStatus.OK)
    @Get(':tenantId/widget-token-secret')
    async widgetTokenSecret(@Param('tenantId') tenantId: string): Promise<WidgetTokenSecretDto> {
        const tenant = await this.prisma.tenant.findFirst({
            where: { id: tenantId, deletedAt: null },
            select: { widgetTokenSecret: true }
        });

        if (!tenant) {
            throw new NotFoundException(`Tenant ${tenantId} not found`);
        }
        if (!tenant.widgetTokenSecret) {
            // 503, not 404 and not an empty string: the caller's correct response is to fail the
            // request and retry, never to treat "no secret" as a secret and accept unverified tokens.
            // The migration backfills every tenant, so this is a tenant created without one.
            throw new ServiceUnavailableException(`Tenant ${tenantId} has no widget token secret`);
        }

        return { secret: tenant.widgetTokenSecret };
    }
}
