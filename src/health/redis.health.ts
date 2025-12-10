import { Injectable } from '@nestjs/common';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { RedisService } from '@mod/common/aws-redis/redis.service';

@Injectable()
export class RedisHealthIndicator {
    constructor(private readonly redis: RedisService) {}

    async check(): Promise<HealthIndicatorResult> {
        const key = `__health__:${Date.now()}`;
        const started = process.hrtime.bigint();
        try {
            await this.redis.set(key, '1', 2);
            await this.redis.del(key);
            return { redis: { status: 'up', latencyMs: Number(process.hrtime.bigint() - started) / 1_000_000 } };
        } catch (caught) {
            return {
                redis: {
                    status: 'down',
                    latencyMs: Number(process.hrtime.bigint() - started) / 1_000_000,
                    error: caught instanceof Error ? caught.message : String(caught)
                }
            };
        }
    }
}
