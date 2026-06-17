import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { ElastiCacheIamAuthProvider } from './elasticache-iam-auth.provider';
import { RedisHealthIndicator } from './redis-health.indicator';
import { RedisKeyBuilder } from './redis-key.builder';
import { RedisService } from './redis.service';

@Global()
@Module({
    imports: [TerminusModule],
    providers: [RedisService, ElastiCacheIamAuthProvider, RedisKeyBuilder, RedisHealthIndicator],
    exports: [RedisService, RedisKeyBuilder, RedisHealthIndicator]
})
export class RedisModule {}
