import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma-gen/generated/client';

import { DatabaseService } from '@app/database/database.service';
import { KratosService } from '@common/auth/kratos.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantStatus } from '@domains/tenant/tenant.types';
import { TenantDeletedEvent, TenantEvents } from '@domains/tenant/events/tenant.events';
import { BillingService } from '@app/features/billing/billing.service';
import { erasedMemberData, isErasedMember } from '@app/features/users/member-erasure';

/** Tenants processed per sweep; the next sweep takes the rest. */
const SWEEP_BATCH = 20;

/**
 * The tenant deletion saga (API Contract v1.3 §8.3, DB Model v2 §0.4). Runs once a scheduled deletion is due:
 *
 * 1. Billing: the Stripe subscription ends now, so a deleted tenant is never charged again.
 * 2. Identity: every member's Ory identity is deleted, which ends all their sessions.
 * 3. Data, in one transaction: API keys revoked, members anonymised in place, invitations, preferences and
 *    settings deleted, the tenant closed and its identifying fields cleared, `tenant.deleted` written to the
 *    outbox (other services purge their own data on it; Keto grants are revoked from it).
 *
 * Every step is idempotent, so a failure part-way is completed by the next sweep. A cancelled or not-yet-due
 * deletion is never executed, whatever triggered the run.
 */
@Injectable()
export class TenantDeletionService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly billing: BillingService,
        private readonly kratos: KratosService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(TenantDeletionService.name);
    }

    /** Ids of open tenants whose deletion is due, oldest first. */
    async findDue(now = new Date()): Promise<string[]> {
        const due = await this.prisma.tenant.findMany({
            where: { deletionDueAt: { lte: now }, status: { not: TenantStatus.CLOSED } },
            orderBy: { deletionDueAt: 'asc' },
            select: { id: true },
            take: SWEEP_BATCH
        });
        return due.map((tenant) => tenant.id);
    }

    /** Runs the saga for one tenant. Returns false when there was nothing to do. */
    async execute(tenantId: string, now = new Date()): Promise<boolean> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant || tenant.status === TenantStatus.CLOSED || !tenant.deletionDueAt || tenant.deletionDueAt > now) {
            return false;
        }

        await this.billing.closeForDeletion(tenantId);
        const members = await this.prisma.user.findMany({ where: { tenantId }, select: { id: true, kratosIdentityId: true } });
        for (const member of members.filter((m) => !isErasedMember(m))) {
            await this.kratos.deleteIdentity(member.kratosIdentityId);
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.apiKey.updateMany({ where: { tenantId, revokedAt: null }, data: { revokedAt: now, deletedAt: now } });
            for (const member of members.filter((m) => !isErasedMember(m))) {
                await tx.user.update({ where: { id: member.id }, data: erasedMemberData(member.id, now) });
            }
            await tx.userRole.deleteMany({ where: { tenantId } });
            await tx.invitation.deleteMany({ where: { tenantId } });
            await tx.userNotificationPreference.deleteMany({ where: { tenantId } });
            await tx.tenantSetting.deleteMany({ where: { tenantId } });
            await tx.tenant.update({
                where: { id: tenantId },
                data: {
                    status: TenantStatus.CLOSED,
                    deletedAt: now,
                    name: 'Deleted tenant',
                    slug: `deleted-${tenantId.toLowerCase()}`,
                    customDomain: null,
                    domainVerificationToken: null,
                    imageId: null,
                    metadata: Prisma.DbNull,
                    lockReason: null,
                    deletionReason: null
                }
            });
            this.txEventEmitter.emitAfterCommit(TenantEvents.DELETED, new TenantDeletedEvent(tenantId, tenantId, tenant.name, tenant.slug));
        });

        this.logger.log('Tenant deleted', { tenantId, members: members.length });
        return true;
    }
}
