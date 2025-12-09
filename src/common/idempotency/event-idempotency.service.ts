import { Injectable } from '@nestjs/common';
import { RedisService } from '@mod/common/aws-redis/redis.service';
import { RedisKeyBuilder } from '@mod/common/aws-redis/redis-key.builder';

@Injectable()
export class EventIdempotencyService {
    private readonly ttl = 86400; // 24 hours

    constructor(
        private readonly redis: RedisService,
        private readonly keys: RedisKeyBuilder,
    ) {}

    async isProcessed(eventId: string, consumerName: string): Promise<boolean> {
        const key = this.keys.build('event:processed', consumerName, eventId);
        const exists = await this.redis.exists(key);
        return exists > 0;
    }

    async markProcessed(eventId: string, consumerName: string, result?: unknown): Promise<void> {
        const key = this.keys.build('event:processed', consumerName, eventId);
        await this.redis.set(
            key,
            JSON.stringify({ processedAt: new Date().toISOString(), result }),
            this.ttl,
        );
    }

    async wasSent(eventId: string, destination: string): Promise<boolean> {
        const key = this.keys.build('event:sent', destination, eventId);
        const exists = await this.redis.exists(key);
        return exists > 0;
    }

    async markSent(eventId: string, destination: string): Promise<void> {
        const key = this.keys.build('event:sent', destination, eventId);
        await this.redis.set(
            key,
            JSON.stringify({ sentAt: new Date().toISOString(), destination }),
            this.ttl,
        );
    }
}
