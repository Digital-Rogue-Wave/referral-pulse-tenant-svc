import { Controller, Get, HttpCode, HttpStatus, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { AllowServices } from '@common/auth/require-permission.decorator';
import { DatabaseService } from '@app/database/database.service';
import { effectiveInvitationChannel, TenantInvitationChannelDto } from '@domains/tenant';

/**
 * R-PRT-02's tenant-level legal envelope for campaign-service, which defaults a campaign's
 * `invitations_enabled` from it and refuses (409 `invitation_channel_forbidden_by_tenant`) to enable
 * what it forbids. Resolved here so no caller re-derives the jurisdiction default.
 *
 * Service tokens only. `tenantId` comes from the path, like the other internal per-tenant reads.
 */
@ApiTags('Internal')
@ApiBearerAuth()
@Controller({ path: 'internal/tenants', version: '1' })
export class InternalInvitationChannelController {
    constructor(private readonly prisma: DatabaseService) {}

    @ApiOperation({ summary: 'The tenant’s effective invitation channel (allowed | forbidden)' })
    @ApiOkResponse({ type: TenantInvitationChannelDto })
    @AllowServices(ServiceCapability.TENANT_INVITATION_CHANNEL_READ)
    @HttpCode(HttpStatus.OK)
    @Get(':tenantId/invitation-channel')
    async invitationChannelOf(@Param('tenantId') tenantId: string): Promise<TenantInvitationChannelDto> {
        const tenant = await this.prisma.tenant.findFirst({
            where: { id: tenantId, deletedAt: null },
            select: { id: true, invitationChannel: true, billingCountry: true }
        });
        if (!tenant) {
            throw new NotFoundException(`Tenant not found: ${tenantId}`);
        }
        return { tenantId: tenant.id, invitationChannel: effectiveInvitationChannel(tenant) };
    }
}
