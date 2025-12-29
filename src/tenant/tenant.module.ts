import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

// Entities
import { TenantEntity } from './tenant.entity';

// Modules
import { FilesModule } from '../files/files.module';
import { HttpClientsModule } from '@mod/common/http/http-clients.module';
import { TenantSettingModule } from '@mod/tenant-setting/tenant-setting.module';
import { TenantAwareRepositoryModule } from '@mod/common/tenant/tenant-aware.repository';
import { TeamMemberModule } from '@mod/team-member/team-member.module';
import { DnsModule } from '../dns/dns.module';

// Controllers
import { AwareTenantController } from './aware/aware-tenant.controller';
import { AgnosticTenantController } from './agnostic/agnostic-tenant.controller';
import { AdminTenantController } from './agnostic/admin-tenant.controller';

// Services
import { AwareTenantService } from './aware/aware-tenant.service';
import { AgnosticTenantService } from './agnostic/agnostic-tenant.service';
import { TenantStatsService } from './aware/tenant-stats.service';

// Listeners & Serialization
import { TenantListener } from './listeners/tenant.listener';
import { TenantSerializationProfile } from './serialization/tenant-serialization.profile';

// Processors
import { TenantDeletionProcessor } from './processors/tenant-deletion.processor';
import { TenantUnlockProcessor } from './processors/tenant-unlock.processor';

// Guards
import { TenantStatusGuard } from './guards/tenant-status.guard';
import { TenantLockGuard } from './guards/tenant-lock.guard';

// Constants
import { TENANT_DELETION_QUEUE } from '@mod/common/bullmq/queues/tenant-deletion.queue';
import { TENANT_UNLOCK_QUEUE } from '@mod/common/bullmq/queues/tenant-unlock.queue';

@Module({
    imports: [
        // Database
        TypeOrmModule.forFeature([TenantEntity]),
        TenantAwareRepositoryModule.forEntities([TenantEntity]),

        // Core Modules
        FilesModule,
        HttpClientsModule,
        TenantSettingModule,
        DnsModule,

        // Background Jobs
        BullModule.registerQueue({ name: TENANT_DELETION_QUEUE }, { name: TENANT_UNLOCK_QUEUE }),

        // Circular Dependencies
        forwardRef(() => TeamMemberModule)
    ],
    controllers: [AwareTenantController, AgnosticTenantController, AdminTenantController],
    providers: [
        // Core Services
        AwareTenantService,
        AgnosticTenantService,
        TenantStatsService,

        // Listeners & Serialization
        TenantSerializationProfile,
        TenantListener,

        // Background Processors
        TenantDeletionProcessor,
        TenantUnlockProcessor,

        // Guards
        TenantStatusGuard,
        TenantLockGuard
    ],
    exports: [AwareTenantService, AgnosticTenantService, TenantStatsService, TenantStatusGuard, TenantLockGuard, DnsModule]
})
export class TenantModule {}
