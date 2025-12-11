import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SesService } from '@mod/common/aws-ses/ses.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { KetoNamespace, KetoRelation } from '@mod/common/auth/keto.constants';

@Injectable()
export class InvitationListener {
    constructor(
        private readonly sesService: SesService,
        private readonly ketoService: KetoService
    ) {}

    @OnEvent('invitation.created')
    async handleInvitationCreatedEvent(payload: { invitationId: string; email: string; token: string; tenantName: string }) {
        const { email, token, tenantName } = payload;
        const subject = `Invitation to join ${tenantName}`;
        const body = `You have been invited to join ${tenantName}. Click here to accept: https://app.referral-pulse.com/invites/${token}`;

        try {
            await this.sesService.sendEmail(email, subject, body);
            console.log(`Email sent to ${email}`);
        } catch (error) {
            console.error('Failed to send invitation email', error);
        }
    }

    @OnEvent('member.joined')
    async handleMemberJoinedEvent(payload: { userId: string; tenantId: string; role: string; invitationId: string }) {
        const { userId, tenantId, role } = payload;

        try {
            // Create Keto relation tuple: user is member of tenant
            await this.ketoService.createTuple({
                namespace: KetoNamespace.TENANT,
                object: tenantId,
                relation: KetoRelation.MEMBER,
                subject_id: userId
            });

            console.log(`Created Keto relation: user ${userId} is ${KetoRelation.MEMBER} of tenant ${tenantId} with role ${role}`);
        } catch (error) {
            console.error('Failed to create Keto relation', error);
            // Consider adding retry logic or dead letter queue
        }
    }
}
