import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from './tenant.entity';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { FilesModule } from '../files/files.module';
import { TenantSerializationProfile } from './serialization/tenant-serialization.profile';
import { TenantListener } from './listeners/tenant.listener';
import { BullModule } from '@nestjs/bullmq';
import { TENANT_DELETION_QUEUE } from '@mod/common/bullmq/queues/tenant-deletion.queue';
import { TenantDeletionProcessor } from './processors/tenant-deletion.processor';
import { HttpClientsModule } from '@mod/common/http/http-clients.module';
import { TenantSettingModule } from '@mod/tenant-setting/tenant-setting.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([TenantEntity]),
        FilesModule,
        HttpClientsModule,
        BullModule.registerQueue({
            name: TENANT_DELETION_QUEUE
        }),
        TenantSettingModule
    ],
    controllers: [TenantController],
    providers: [TenantService, TenantSerializationProfile, TenantListener, TenantDeletionProcessor],
    exports: [TenantService]
})
export class TenantModule {}
