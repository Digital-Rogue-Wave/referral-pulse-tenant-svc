import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeatureFlagEntity } from './feature-flag.entity';
import { FeatureFlagService } from './feature-flag.service';
import { RedisModule } from '@mod/common/aws-redis/redis.module';
import { FeatureFlagController } from './feature-flag.controller';

@Global()
@Module({
    imports: [TypeOrmModule.forFeature([FeatureFlagEntity]), RedisModule],
    controllers: [FeatureFlagController],
    providers: [FeatureFlagService],
    exports: [FeatureFlagService]
})
export class FeatureFlagModule {}
