import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from './tenant.entity';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { SnsModule } from '@mod/common/aws-sqs/sns.module';
import { AuditLog } from '@mod/common/entities/audit-log.entity';
import { AuditService } from '@mod/common/services/audit.service';
import { FilesModule } from '../files/files.module';
import { TenantSerializationProfile } from './serialization/tenant-serialization.profile';
import { AuthModule } from '@mod/common/auth/auth.module';
import { TenantListener } from './listeners/tenant.listener';

@Module({
    imports: [TypeOrmModule.forFeature([TenantEntity, AuditLog]), SnsModule, FilesModule, AuthModule],
    controllers: [TenantController],
    providers: [TenantService, AuditService, TenantSerializationProfile, TenantListener],
    exports: [TenantService, AuditService]
})
export class TenantModule {}
