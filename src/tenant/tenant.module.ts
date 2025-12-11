import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from './tenant.entity';
import { TeamMemberEntity } from './team-member.entity';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { TeamMemberController } from './team-member.controller';
import { TeamMemberService } from './team-member.service';
import { SnsModule } from '@mod/common/aws-sqs/sns.module';
import { AuditLog } from '@mod/common/entities/audit-log.entity';
import { AuditService } from '@mod/common/services/audit.service';
import { FilesModule } from '../files/files.module';
import { TenantSerializationProfile } from './serialization/tenant-serialization.profile';
import { TeamMemberSerializationProfile } from './serialization/team-member-serialization.profile';
import { AuthModule } from '@mod/common/auth/auth.module';
import { TenantListener } from './listeners/tenant.listener';

@Module({
    imports: [TypeOrmModule.forFeature([TenantEntity, AuditLog, TeamMemberEntity]), SnsModule, FilesModule, AuthModule],
    controllers: [TenantController, TeamMemberController],
    providers: [TenantService, TeamMemberService, AuditService, TenantSerializationProfile, TeamMemberSerializationProfile, TenantListener],
    exports: [TenantService, TeamMemberService, AuditService]
})
export class TenantModule {}
