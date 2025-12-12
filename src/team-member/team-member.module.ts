import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeamMemberEntity } from './team-member.entity';
import { TeamMemberController } from './team-member.controller';
import { TeamMemberService } from './team-member.service';
import { FilesModule } from '../files/files.module';
import { TeamMemberSerializationProfile } from './serialization/team-member-serialization.profile';
import { BullModule } from '@nestjs/bullmq';
import { TENANT_DELETION_QUEUE } from '@mod/common/bullmq/queues/tenant-deletion.queue';
import { TenantDeletionProcessor } from '@mod/common/bullmq/processors/tenant-deletion.processor';
import { TenantModule } from '@mod/tenant/tenant.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([TeamMemberEntity]),
        FilesModule,
        TenantModule,
        BullModule.registerQueue({
            name: TENANT_DELETION_QUEUE
        })
    ],
    controllers: [TeamMemberController],
    providers: [TeamMemberService, TeamMemberSerializationProfile, TenantDeletionProcessor],
    exports: [TeamMemberService]
})
export class TeamMemberModule {}
