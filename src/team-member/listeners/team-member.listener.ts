import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SesService } from '@mod/common/aws-ses/ses.service';
import { KratosService } from '@mod/common/auth/kratos.service';

import { MemberRoleUpdatedEvent } from '@mod/common/interfaces/team-member-events.interface';

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
}
