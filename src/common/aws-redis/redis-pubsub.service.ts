import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RedisFactory } from './redis.factory';
import { RedisKeyBuilder } from './redis-key.builder';

type MessageHandler = (channel: string, message: string) => void;

@Injectable()
export class RedisPubSubService {
    private readonly pub: Redis | import('ioredis').Cluster;
    private readonly sub?: Redis;

    constructor(factory: RedisFactory, @Optional() @Inject() private readonly keys?: RedisKeyBuilder) {
        this.pub = factory.getClient();
        this.sub = factory.getSubscriber();
    }

    private ch(ch: string): string { return this.keys ? this.keys.build(ch) : ch; }

    async publish(channel: string, message: string): Promise<number> { return this.pub.publish(this.ch(channel), message); }

    async subscribe(channel: string, handler: MessageHandler): Promise<() => Promise<void>> {
        if (!this.sub) throw new Error('Subscriber not enabled (set REDIS_SUBSCRIBER_CREATE=true)');
        const c = this.ch(channel);
        await this.sub.subscribe(c);
        const listener = (message: string, raw: string) => { if (raw === c) handler(c, message); };
        this.sub.on('message', listener);
        return async () => { this.sub?.off('message', listener); await this.sub?.unsubscribe(c); };
    }
}
