import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';

import { DateService } from '@common/helper/date.service';

import { RedisService } from './redis.service';

@Injectable()
export class RedisHealthIndicator {
    constructor(
        private readonly healthIndicatorService: HealthIndicatorService,
        private readonly redisService: RedisService,
        private readonly dateService: DateService
    ) {}

    async isHealthy(key: string): Promise<HealthIndicatorResult> {
        const indicator = this.healthIndicatorService.check(key);
        const startTime = this.dateService.now();

        try {
            const result = await this.redisService.ping();
            const latency = this.dateService.now() - startTime;

            if (result === 'PONG') {
                return indicator.up({
                    latency,
                    connected: this.redisService.isConnected()
                });
            }
            return indicator.down({ response: result });
        } catch (error) {
            const latency = this.dateService.now() - startTime;
            return indicator.down({
                latency,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
