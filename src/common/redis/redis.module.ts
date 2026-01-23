import { Global, Module, Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { RedisService } from './redis.service';
import { ElastiCacheIamAuthProvider } from './elasticache-iam-auth.provider';
import { RedisKeyBuilder } from './redis-key.builder';
import { DateService } from '@app/common/helper/date.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
    constructor(
        private readonly redisService: RedisService,
        private readonly dateService: DateService,
    ) {
        super();
    }

    async isHealthy(key: string): Promise<HealthIndicatorResult> {
        const startTime = this.dateService.now();
        try {
            const result = await this.redisService.ping();
            const latency = this.dateService.now() - startTime;
            if (result === 'PONG') {
                return this.getStatus(key, true, { latency, connected: this.redisService.isConnected() });
            }
            throw new HealthCheckError('Redis ping failed', this.getStatus(key, false, { response: result }));
        } catch (error) {
            const latency = this.dateService.now() - startTime;
            throw new HealthCheckError(
                'Redis health check failed',
                this.getStatus(key, false, { latency, error: error instanceof Error ? error.message : 'Unknown error' }),
            );
        }
    }
}

@Global()
@Module({
    providers: [RedisService, ElastiCacheIamAuthProvider, RedisKeyBuilder, RedisHealthIndicator],
    exports: [RedisService, RedisKeyBuilder, RedisHealthIndicator],
})
export class RedisModule {}
