import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrivateInvitationController } from './private/private-invitation.controller';
import { PublicInvitationController } from './public/public-invitation.controller';
import { PrivateInvitationService } from './private/private-invitation.service';
import { PublicInvitationService } from './public/public-invitation.service';
import { InvitationEntity } from './invitation.entity';
import { TeamMemberEntity } from '../tenant/team-member.entity';
import { InvitationSerializationProfile } from './serialization/invitation-serialization.profile';
import { TenantModule } from '@mod/tenant/tenant.module';
import { InvitationListener } from './listeners/invitation.listener';
import { TenantAwareRepositoryModule } from '@mod/common/tenant/tenant-aware.repository';

@Module({
    imports: [
        TypeOrmModule.forFeature([InvitationEntity, TeamMemberEntity]),
        TenantAwareRepositoryModule.forEntities([InvitationEntity]),
        TenantModule
    ],
    controllers: [PrivateInvitationController, PublicInvitationController],
    providers: [PrivateInvitationService, PublicInvitationService, InvitationSerializationProfile, InvitationListener],
    exports: [PrivateInvitationService, PublicInvitationService]
})
export class InvitationModule {}
