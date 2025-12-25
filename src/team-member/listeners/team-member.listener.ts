import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SesService } from '@mod/common/aws-ses/ses.service';
import { KratosService } from '@mod/common/auth/kratos.service';

import { MemberRoleUpdatedEvent, MemberRemovedEvent } from '@mod/common/interfaces/team-member-events.interface';
import { AuditAction, AuditService } from '@mod/common/audit';

@Injectable()
export class TeamMemberListener {
    private readonly logger = new Logger(TeamMemberListener.name);

    constructor(
        private readonly sesService: SesService,
        private readonly kratosService: KratosService,
        private readonly auditService: AuditService
    ) {}

    @OnEvent('member.role.updated')
    async handleMemberRoleUpdated(payload: MemberRoleUpdatedEvent) {
        const { userId, newRole, memberId, userAgent, ipAddress, oldRole } = payload;
        // Fetch identity to get email
        const identity = await this.kratosService.getIdentity(userId);
        const email = identity.traits?.email;

        if (email) {
            await this.sesService.sendEmail(email, 'Role Updated', `Your role has been updated to ${newRole}.`);
            this.logger.log(`Sent role update notification to ${email}`);
        } else {
            this.logger.warn(`No email found for user ${userId}, skipping role update notification`);
        }

        // Audit logging
        await this.auditService.log({
            tenantId: memberId,
            userId: userId,
            action: AuditAction.MEMBER_ROLE_UPDATED,
            description: `Updated role for member ${userId} from ${oldRole} to ${newRole}`,
            metadata: {
                memberId: memberId,
                targetUserId: userId,
                oldRole,
                newRole
            },
            ipAddress,
            userAgent
        });
    }

    @OnEvent('member.removed')
    async handleMemberRemoved(payload: MemberRemovedEvent) {
        const { userId, memberId, tenantId, userAgent, ipAddress } = payload;
        // Task 62: Invalidate member's sessions
        await this.kratosService.revokeSessions(userId);
        this.logger.log(`Invalidated sessions for removed user ${userId}`);

        // Task 63: Send removal notification
        const identity = await this.kratosService.getIdentity(userId);
        const email = identity.traits?.email;

        if (email) {
            await this.sesService.sendEmail(
                email,
                'Removed from Organization',
                'You have been removed from the organization. You no longer have access to the dashboard.'
            );
            this.logger.log(`Sent removal notification to ${email}`);
        }

        await this.auditService.log({
            tenantId: tenantId,
            userId,
            action: AuditAction.MEMBER_REMOVED,
            description: `Removed member ${userId} from tenant`,
            metadata: {
                memberId,
                targetUserId: userId
            },
            ipAddress,
            userAgent
        });
    }
}
