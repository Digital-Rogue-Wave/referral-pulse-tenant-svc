import { Module, forwardRef } from '@nestjs/common';

// Modules
import { FilesModule } from '../files/files.module';
import { HttpModule } from '@common/http/http.module';
import { TenantSettingModule } from '@app/features/tenant-setting/tenant-setting.module';
import { TeamMemberModule } from '@app/features/team-member/team-member.module';
import { DnsModule } from '../dns/dns.module';

// Controllers
import { AwareTenantController } from './aware/aware-tenant.controller';
import { AgnosticTenantController } from './agnostic/agnostic-tenant.controller';
import { AdminTenantController } from './agnostic/admin-tenant.controller';
import { InternalTenantVerificationController } from './internal-tenant-verification.controller';

// Services
import { TenantService } from './tenant.service';
import { TenantStatsService } from './aware/tenant-stats.service';

// Listeners
import { TenantListener } from './listeners/tenant.listener';

// Processors
import { TenantDeletionProcessor } from './processors/tenant-deletion.processor';
import { TenantUnlockProcessor } from './processors/tenant-unlock.processor';

// Guards
import { TenantStatusGuard } from './guards/tenant-status.guard';
import { TenantLockGuard } from './guards/tenant-lock.guard';

@Module({
    imports: [
        // Core Modules
        FilesModule,
        HttpModule,
        TenantSettingModule,
        DnsModule,

        // BullJobsModule is @Global() - no need to import

        // Circular Dependencies
        forwardRef(() => TeamMemberModule)
    ],
    controllers: [AwareTenantController, AgnosticTenantController, AdminTenantController, InternalTenantVerificationController],
    providers: [
        // Core Services
        TenantService,
        TenantStatsService,

        // Listeners
        TenantListener,

        // Background Processors
        TenantDeletionProcessor,
        TenantUnlockProcessor,

        // Guards
        TenantStatusGuard,
        TenantLockGuard
    ],
    exports: [TenantService, TenantStatsService, TenantStatusGuard, TenantLockGuard, DnsModule]
})
export class TenantModule {}
