import { Module } from '@nestjs/common';

// Modules
import { FilesModule } from '../files/files.module';
import { HttpModule } from '@common/http/http.module';
import { TenantSettingModule } from '@app/features/tenant-setting/tenant-setting.module';
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
import { UsersModule } from '../users/users.module';

// Processors
import { TenantDeletionProcessor } from './processors/tenant-deletion.processor';
import { TenantUnlockProcessor } from './processors/tenant-unlock.processor';

@Module({
    imports: [
        // Core Modules
        FilesModule,
        HttpModule,
        TenantSettingModule,
        DnsModule,
        UsersModule

        // BullJobsModule is @Global() - no need to import
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
        TenantUnlockProcessor
    ],
    exports: [TenantService, TenantStatsService, DnsModule]
})
export class TenantModule {}
