import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import redisConfig from '@mod/config/redis.config';
import { RedisFactory } from './redis.factory';
import { RedisService } from './redis.service';
import { RedisPubSubService } from './redis-pubsub.service';
import { RedisKeyBuilder } from './redis-key.builder';
import { HelperModule } from '@mod/common/helpers/helper.module';
import { ElastiCacheIamAuthProvider } from '@mod/common/aws-redis/redis-iam-auth.provider';

@Module({
    imports: [ConfigModule.forFeature(redisConfig), HelperModule],
    providers: [
        RedisFactory,
        RedisService,
        RedisPubSubService,
        RedisKeyBuilder,
        ElastiCacheIamAuthProvider
    ],
    exports: [
        RedisService,
        RedisPubSubService,
        RedisKeyBuilder,
    ],
})
export class RedisModule {}
