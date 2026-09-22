import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@app/database/database.service';
import { KratosService } from '@common/auth/kratos.service';
import { RoleEnum } from '@common/enums/role.enum';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { PRODUCING_SERVICE } from '@common/events/outbox/event-outbox.writer';
import { ErasureReceiptResponse, OperatorErasureDto } from '@domains/erasure';
import { TenantStatus } from '@domains/tenant/tenant.types';
import { UserAnonymisedEvent, UserRemovedEvent } from '@domains/user';

import { erasedMemberData, isErasedMember } from './member-erasure';

/** What erasure keeps, and why — returned in every receipt so the subject can be told (Product Spec v4). */
const RETAINED = ['audit_log: the operator id (not identifying) on past actions, for tenant lifetime + 12 months (API §8.3)'];

type Member = { id: string; tenantId: string; role: string; email: string; kratosIdentityId: string; deletedAt: Date | null };

/**
 * Identity's part of a data-subject erasure: every operator record of the subject is anonymised in place,
 * their Ory identities are deleted and their pending invitations removed. Idempotent: an erased record is
 * reported again, never processed twice.
 *
 * A subject who still owns an open tenant is not erased (`blocked`): the tenant would be left without an
 * Owner. They transfer ownership or delete the tenant first.
 */
@Injectable()
export class OperatorErasureService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly kratos: KratosService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(OperatorErasureService.name);
    }

    async erase(dto: OperatorErasureDto, now = new Date()): Promise<ErasureReceiptResponse> {
        const members: Member[] = await this.prisma.user.findMany({
            where: dto.userId ? { id: dto.userId } : { emailHash: dto.subjectEmailHash },
            select: { id: true, tenantId: true, role: true, email: true, kratosIdentityId: true, deletedAt: true }
        });
        if (members.length === 0) {
            return this.receipt(dto, 'not_found', [], now);
        }
        const live = members.filter((member) => !isErasedMember(member));
        if (await this.ownsOpenTenant(live)) {
            return this.receipt(dto, 'blocked', [], now, 'owner_of_active_tenant');
        }

        for (const identity of new Set(live.map((member) => member.kratosIdentityId))) {
            await this.kratos.deleteIdentity(identity);
        }
        await this.prisma.$transaction(async (tx) => {
            for (const member of live) {
                await tx.user.update({ where: { id: member.id }, data: erasedMemberData(member.id, member.deletedAt ?? now) });
                await tx.userRole.deleteMany({ where: { userId: member.id } });
                await tx.userNotificationPreference.deleteMany({ where: { userId: member.id } });
                if (!member.deletedAt) {
                    this.txEventEmitter.emitAfterCommit('user.removed', new UserRemovedEvent(member.id, member.tenantId, member.role));
                }
                this.txEventEmitter.emitAfterCommit('user.anonymised', new UserAnonymisedEvent(member.id, member.tenantId, dto.dsrId));
            }
            const addresses = [...new Set(live.map((member) => member.email))];
            if (addresses.length > 0) {
                await tx.invitation.deleteMany({
                    where: { OR: addresses.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })) }
                });
            }
        });

        this.logger.log('Operator data erased', { dsrId: dto.dsrId, records: live.length });
        return this.receipt(
            dto,
            'completed',
            members.map((member) => member.id),
            now
        );
    }

    private async ownsOpenTenant(members: Member[]): Promise<boolean> {
        const owned = members.filter((member) => member.role === RoleEnum.OWNER && !member.deletedAt).map((member) => member.tenantId);
        if (owned.length === 0) {
            return false;
        }
        return (await this.prisma.tenant.count({ where: { id: { in: owned }, status: { not: TenantStatus.CLOSED } } })) > 0;
    }

    private receipt(
        dto: OperatorErasureDto,
        status: ErasureReceiptResponse['status'],
        erasedUserIds: string[],
        now: Date,
        blockedReason: string | null = null
    ): ErasureReceiptResponse {
        return {
            dsrId: dto.dsrId,
            service: PRODUCING_SERVICE,
            status,
            erasedUserIds,
            blockedReason,
            retained: status === 'completed' ? RETAINED : [],
            processedAt: now
        };
    }
}
