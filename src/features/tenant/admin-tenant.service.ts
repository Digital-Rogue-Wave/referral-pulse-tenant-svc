import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RoleEnum } from '@common/enums/role.enum';
import { invitationResponseMapper } from '@domains/invitation';
import { AdminCreateTenantDto, AdminTenantCreatedResponse, tenantResponseMapper } from '@domains/tenant';
import { TenantEvents, TenantVerificationRequestedEvent } from '@domains/tenant/events/tenant.events';

import { InvitationService } from '../invitation/invitation.service';
import { TenantService } from './tenant.service';

/**
 * Tenant provisioning from the platform console (US1.1.1, Product Spec §4 Super Admin "Tenant provisioning").
 * A Super Admin is never a member of the client's tenant (R-ACT-02), so the tenant is created without an
 * Owner and the client's Owner joins through an OWNER invitation, written in the same transaction.
 */
@Injectable()
export class AdminTenantService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenants: TenantService,
        private readonly invitations: InvitationService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(AdminTenantService.name);
    }

    async create(dto: AdminCreateTenantDto, adminUserId: string): Promise<AdminTenantCreatedResponse> {
        const id = ulid();
        const slug = await this.tenants.freeSlug(dto.name, id, dto.slug);

        const { tenant, invitation } = await this.prisma.$transaction(async (tx) => {
            const inserted = await this.tenants.insertTenant(tx, { id, name: dto.name, slug, ownerIdentityId: null, actingUserId: adminUserId });
            const ownerInvitation = await this.invitations.issue(tx, {
                tenantId: id,
                email: dto.ownerEmail,
                role: RoleEnum.OWNER,
                actingUserId: adminUserId
            });
            this.txEventEmitter.emitAfterCommit(
                TenantEvents.VERIFICATION_REQUESTED,
                new TenantVerificationRequestedEvent(id, id, inserted.tenant.name, adminUserId, inserted.verificationId)
            );
            return { tenant: inserted.tenant, invitation: ownerInvitation };
        });

        this.logger.log('Tenant created by a platform admin', { tenantId: tenant.id, slug: tenant.slug, invitationId: invitation.id });
        return { tenant: tenantResponseMapper.toResponse(tenant), ownerInvitation: invitationResponseMapper.toResponse(invitation) };
    }
}
