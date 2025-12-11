import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';
import { InvitationEntity } from './invitation.entity';
import { TeamMemberEntity } from '../tenant/team-member.entity';
import { InvitationSerializationProfile } from './serialization/invitation-serialization.profile';
import { TenantModule } from '@mod/tenant/tenant.module';
import { InvitationListener } from './listeners/invitation.listener';

@Module({
    imports: [TypeOrmModule.forFeature([InvitationEntity, TeamMemberEntity]), TenantModule],
    controllers: [InvitationController],
    providers: [InvitationService, InvitationSerializationProfile, InvitationListener],
    exports: [InvitationService]
})
export class InvitationModule {}
