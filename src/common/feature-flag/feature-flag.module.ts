import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeatureFlagEntity } from './feature-flag.entity';
import { TenantFeatureFlagEntity } from './tenant-feature-flag.entity';
import { FeatureFlagService } from './feature-flag.service';
import { RedisModule } from '@mod/common/aws-redis/redis.module';

@Global()
@Module({
    imports: [TypeOrmModule.forFeature([FeatureFlagEntity, TenantFeatureFlagEntity]), RedisModule],
    providers: [FeatureFlagService],
    exports: [FeatureFlagService]
})
export class FeatureFlagModule {}
