import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from './tenant.entity';
import { TenantController } from './tenant.controller';
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

@Module({
    imports: [
        TypeOrmModule.forFeature([TenantEntity]),
        TenantAwareRepositoryModule.forEntities([TenantEntity]),
        FilesModule,
        HttpClientsModule,
        BullModule.registerQueue({
            name: TENANT_DELETION_QUEUE
        }),
        TenantSettingModule
    ],
    controllers: [TenantController],
    providers: [AwareTenantService, AgnosticTenantService, TenantSerializationProfile, TenantListener, TenantDeletionProcessor],
    exports: [AwareTenantService, AgnosticTenantService]
})
export class TenantModule {}
