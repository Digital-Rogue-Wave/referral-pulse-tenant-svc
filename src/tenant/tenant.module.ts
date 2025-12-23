import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from './tenant.entity';
import { ReservedSubdomainEntity } from './reserved-subdomain.entity';
import { FilesModule } from '../files/files.module';
import { TenantSerializationProfile } from './serialization/tenant-serialization.profile';
import { TenantListener } from './listeners/tenant.listener';
import { BullModule } from '@nestjs/bullmq';
import { TENANT_DELETION_QUEUE } from '@mod/common/bullmq/queues/tenant-deletion.queue';
import { TenantDeletionProcessor } from './processors/tenant-deletion.processor';
import { HttpClientsModule } from '@mod/common/http/http-clients.module';
import { TenantSettingModule } from '@mod/tenant-setting/tenant-setting.module';
import { TenantAwareRepositoryModule } from '@mod/common/tenant/tenant-aware.repository';
import { AgnosticTenantService } from './agnostic/agnostic-tenant.service';
import { AwareTenantService } from './aware/aware-tenant.service';
import { AwareTenantController } from './aware/aware-tenant.controller';
import { AgnosticTenantController } from './agnostic/agnostic-tenant.controller';
import { AdminTenantController } from './agnostic/admin-tenant.controller';
import { DnsVerificationService } from './dns/dns-verification.service';
import { DomainProvisioningService } from './dns/domain-provisioning.service';
import { SubdomainService } from './dns/subdomain.service';

import { TenantStatsService } from './tenant-stats.service';
import { TeamMemberModule } from '@mod/team-member/team-member.module';

import { TenantStatusGuard } from './guards/tenant-status.guard';

@Module({
    imports: [
        TypeOrmModule.forFeature([TenantEntity, ReservedSubdomainEntity]),
        TenantAwareRepositoryModule.forEntities([TenantEntity, ReservedSubdomainEntity]),
        FilesModule,
        HttpClientsModule,
        BullModule.registerQueue({
            name: TENANT_DELETION_QUEUE
        }),
        TenantSettingModule,
        forwardRef(() => TeamMemberModule)
    ],
    controllers: [AwareTenantController, AgnosticTenantController, AdminTenantController],
    providers: [
        AwareTenantService,
        AgnosticTenantService,
        TenantSerializationProfile,
        TenantListener,
        TenantDeletionProcessor,
        DnsVerificationService,
        DomainProvisioningService,
        SubdomainService,
        TenantStatsService,
        TenantStatusGuard
    ],
    exports: [AwareTenantService, AgnosticTenantService, SubdomainService, TenantStatsService, TenantStatusGuard]
})
export class TenantModule {}
