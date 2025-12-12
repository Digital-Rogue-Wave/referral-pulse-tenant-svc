import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from './tenant.entity';
import { TeamMemberEntity } from './team-member.entity';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { TeamMemberController } from './team-member.controller';
import { TeamMemberService } from './team-member.service';
import { FilesModule } from '../files/files.module';
import { TenantSerializationProfile } from './serialization/tenant-serialization.profile';
import { TeamMemberSerializationProfile } from './serialization/team-member-serialization.profile';
import { TenantListener } from './listeners/tenant.listener';

@Module({
    imports: [TypeOrmModule.forFeature([TenantEntity, TeamMemberEntity]), FilesModule],
    controllers: [TenantController, TeamMemberController],
    providers: [TenantService, TeamMemberService, TenantSerializationProfile, TeamMemberSerializationProfile, TenantListener],
    exports: [TenantService, TeamMemberService]
})
export class TenantModule {}
