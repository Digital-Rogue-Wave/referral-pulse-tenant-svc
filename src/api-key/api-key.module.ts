import { Module } from '@nestjs/common';
import { ApiKeyEntity } from './api-key.entity';
import { ApiKeyService } from './api-key.service';
import { ApiKeyController } from './api-key.controller';
import { TenantAwareRepositoryModule } from '@mod/common/tenant/tenant-aware.repository';
import { ApiKeyListener } from './listeners/api-key.listener';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
    imports: [TypeOrmModule.forFeature([ApiKeyEntity]), TenantAwareRepositoryModule.forEntities([ApiKeyEntity])],
    controllers: [ApiKeyController],
    providers: [ApiKeyService, ApiKeyListener],
    exports: [ApiKeyService]
})
export class ApiKeyModule {}
