import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SesService } from '@mod/common/aws-ses/ses.service';
import { KratosService } from '@mod/common/auth/kratos.service';

import { MemberRoleUpdatedEvent, MemberRemovedEvent } from '@mod/common/interfaces/team-member-events.interface';

@Injectable()
export class TeamMemberListener {
    private readonly logger = new Logger(TeamMemberListener.name);

    constructor(
        private readonly sesService: SesService,
        private readonly kratosService: KratosService
    ) {}

    @OnEvent('member.role.updated')
    async handleMemberRoleUpdated(payload: MemberRoleUpdatedEvent) {
        const { userId, newRole } = payload;
        // Fetch identity to get email
        const identity = await this.kratosService.getIdentity(userId);
        const email = identity.traits?.email;

        if (email) {
            await this.sesService.sendEmail(email, 'Role Updated', `Your role has been updated to ${newRole}.`);
            this.logger.log(`Sent role update notification to ${email}`);
        } else {
            this.logger.warn(`No email found for user ${userId}, skipping role update notification`);
        }
    }

    @OnEvent('member.removed')
    async handleMemberRemoved(payload: MemberRemovedEvent) {
        const { userId } = payload;

        try {
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
        } catch (error) {
            this.logger.error(`Error handling member removal for user ${userId}:`, error);
        }
    }
}
