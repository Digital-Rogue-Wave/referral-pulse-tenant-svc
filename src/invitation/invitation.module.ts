import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwareInvitationController } from './aware/aware-invitation.controller';
import { AgnosticInvitationController } from './agnostic/agnostic-invitation.controller';
import { AwareInvitationService } from './aware/aware-invitation.service';
import { AgnosticInvitationService } from './agnostic/agnostic-invitation.service';
import { InvitationEntity } from './invitation.entity';
import { InvitationSerializationProfile } from './serialization/invitation-serialization.profile';
import { TenantModule } from '@mod/tenant/tenant.module';
import { InvitationListener } from './listeners/invitation.listener';
import { TenantAwareRepositoryModule } from '@mod/common/tenant/tenant-aware.repository';
import { TeamMemberModule } from '@mod/team-member/team-member.module';
import { SnsModule } from '@mod/common/aws-sqs/sns.module';
import { BullModule } from '@nestjs/bullmq';
import { INVITATION_QUEUE } from '@mod/common/bullmq/queues/invitation.queue';
import { InvitationProcessor } from './processors/invitation.processor';
import { InvitationQueueService } from './invitation-queue.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([InvitationEntity]),
        TenantAwareRepositoryModule.forEntities([InvitationEntity]),
        TenantModule,
        TeamMemberModule,
        SnsModule,
        BullModule.registerQueue({
            name: INVITATION_QUEUE
        })
    ],
    controllers: [AwareInvitationController, AgnosticInvitationController],
    providers: [
        AwareInvitationService,
        AgnosticInvitationService,
        InvitationSerializationProfile,
        InvitationListener,
        InvitationProcessor,
        InvitationQueueService
    ],
    exports: [AwareInvitationService, AgnosticInvitationService]
})
export class InvitationModule {}
