import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SesService } from '@mod/common/aws-ses/ses.service';
import { KetoService } from '@mod/common/auth/keto.service';
import { KetoNamespace, KetoRelation } from '@mod/common/auth/keto.constants';
import { SnsPublisher } from '@mod/common/aws-sqs/sns.publisher';
import { KratosService } from '@mod/common/auth/kratos.service';
import { MemberInvitedEvent } from '@mod/common/interfaces/invitation-events.interface';
import { PublishSnsEventDto, SnsPublishOptionsDto } from '@mod/common/dto/sns-publish.dto';
import { Utils } from '@mod/common/utils/utils';
import { randomUUID } from 'node:crypto';

import { InvitationCreatedEvent, MemberJoinedEvent } from '@mod/common/interfaces/invitation-events.interface';

@Injectable()
export class InvitationListener {
    constructor(
        private readonly sesService: SesService,
        private readonly ketoService: KetoService,
        private readonly kratosService: KratosService,
        private readonly sns: SnsPublisher
    ) {}

    @OnEvent('invitation.created')
    async handleInvitationCreatedEvent(payload: InvitationCreatedEvent) {
        const { email, token, tenantName } = payload;
        const subject = `Invitation to join ${tenantName}`;
        const body = `You have been invited to join ${tenantName}. Click here to accept: https://app.referral-pulse.com/invites/${token}`;

        await this.sesService.sendEmail(email, subject, body);
        console.log(`Email sent to ${email}`);
    }

    @OnEvent('member.invited')
    async handleMemberInvitedEvent(payload: MemberInvitedEvent) {
        const { invitationId, email, tenantId, role, expiresAt } = payload;

        // Publish SNS Event
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: invitationId ?? randomUUID(),
            tenantId,
            eventType: 'member.invited',
            data: {
                email,
                tenantId,
                role,
                expiresAt
            },
            timestamp: new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'tenant-events',
            groupId: tenantId,
            deduplicationId: invitationId
        });

        await this.sns.publish(snsEventDto, snsOptionsDto);
        console.log(`Published member.invited event to SNS for ${email}`);
    }

    @OnEvent('member.joined')
    async handleMemberJoinedEvent(payload: MemberJoinedEvent) {
        const { userId, tenantId, role, invitationId } = payload;

        // Create Keto relation tuple: user is member of tenant
        await this.ketoService.createTuple({
            namespace: KetoNamespace.TENANT,
            object: tenantId,
            relation: KetoRelation.MEMBER,
            subject_id: userId
        });

        // Publish SNS Event
        const snsEventDto = await Utils.validateDtoOrFail(PublishSnsEventDto, {
            eventId: invitationId ?? randomUUID(),
            tenantId,
            eventType: 'member.joined',
            data: {
                userId,
                tenantId,
                role
            },
            timestamp: new Date().toISOString()
        });

        const snsOptionsDto = await Utils.validateDtoOrFail(SnsPublishOptionsDto, {
            topic: 'tenant-events',
            groupId: tenantId,
            deduplicationId: invitationId || `${tenantId}:${userId}`
        });

        await this.sns.publish(snsEventDto, snsOptionsDto);

        // Update Ory Kratos metadata
        try {
            await this.kratosService.updateIdentityMetadata(userId, {
                public: {
                    tenantId: tenantId
                }
            });
            console.log(`Updated Ory Kratos metadata for user ${userId} with tenantId ${tenantId}`);
        } catch (error) {
            console.error(`Failed to update Ory Kratos metadata for user ${userId}:`, error);
        }

        console.log(`Created Keto relation and published member.joined event to SNS for user ${userId} in tenant ${tenantId}`);
    }
}
