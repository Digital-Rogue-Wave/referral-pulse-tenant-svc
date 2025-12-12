import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeatureFlagEntity } from './feature-flag.entity';
import { FeatureFlagService } from './feature-flag.service';
import { RedisModule } from '@mod/common/aws-redis/redis.module';

@Global()
@Module({
    imports: [TypeOrmModule.forFeature([FeatureFlagEntity]), RedisModule],
    providers: [FeatureFlagService],
    exports: [FeatureFlagService]
})
export class FeatureFlagModule {}
