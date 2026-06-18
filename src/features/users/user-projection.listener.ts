import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { DatabaseService } from '@app/database/database.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { TeamMemberCreatedEvent, TeamMemberRoleUpdatedEvent } from '@domains/team-member';
import { UserRegisteredEvent, UserRoleChangedEvent } from '@domains/user';

/**
 * Projects the canonical identity tables (users, user_roles) from the team-member
 * lifecycle and emits the platform user.* contract (referralai_event_model_v2.1.md §4.12).
 *
 * Ory Kratos is the credential authority; `users` is keyed by kratos_identity_id.
 * team_members remains the existing API surface — see NOTE.md for the overlap/consolidation note.
 */
@Injectable()
export class UserProjectionListener {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(UserProjectionListener.name);
    }

    @OnEvent('team-member.created', { async: true })
    async handleMemberCreated(event: TeamMemberCreatedEvent): Promise<void> {
        const { userId: kratosIdentityId, tenantId, role } = event.payload;

        try {
            const user = await this.upsertUser(kratosIdentityId, tenantId);
            await this.assignRole(user.id, tenantId, role, event.userId);

            this.txEventEmitter.emitAfterCommit('user.registered', new UserRegisteredEvent(user.id, tenantId, role, event.userId));
        } catch (error) {
            this.logger.error(
                `Failed to project user.registered for ${kratosIdentityId}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    @OnEvent('team-member.updated', { async: true })
    async handleMemberRoleChanged(event: TeamMemberRoleUpdatedEvent): Promise<void> {
        const { userId: kratosIdentityId, tenantId, oldRole, newRole } = event.payload;

        try {
            const user = await this.upsertUser(kratosIdentityId, tenantId);
            await this.assignRole(user.id, tenantId, newRole, event.userId, true);

            this.txEventEmitter.emitAfterCommit('user.role_changed', new UserRoleChangedEvent(user.id, tenantId, oldRole, newRole, event.userId));
        } catch (error) {
            this.logger.error(
                `Failed to project user.role_changed for ${kratosIdentityId}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /** Upsert the local user projection keyed by (tenantId, kratos_identity_id). */
    private async upsertUser(kratosIdentityId: string, tenantId: string): Promise<{ id: string }> {
        return this.prisma.user.upsert({
            where: { tenantId_kratosIdentityId: { tenantId, kratosIdentityId } },
            update: {},
            create: { tenantId, kratosIdentityId },
            select: { id: true }
        });
    }

    /** Assign a role to a user, replacing any prior assignment when the role changes. */
    private async assignRole(userId: string, tenantId: string, roleName: string, assignedBy?: string, replace = false): Promise<void> {
        const role = await this.prisma.role.findUnique({ where: { name: roleName }, select: { id: true } });
        if (!role) {
            this.logger.warn(`Role "${roleName}" not found — skipping user_roles projection (run the seed)`);
            return;
        }

        if (replace) {
            await this.prisma.userRole.deleteMany({ where: { userId } });
        }

        await this.prisma.userRole.upsert({
            where: { userId_roleId: { userId, roleId: role.id } },
            update: { assignedBy },
            create: { userId, roleId: role.id, tenantId, assignedBy }
        });
    }
}
