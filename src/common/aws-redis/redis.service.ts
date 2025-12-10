import { Injectable } from '@nestjs/common';
import type { Redis, Cluster } from 'ioredis';
import { RedisFactory } from './redis.factory';
import type { Json } from '@mod/types/app.type';
import { NullableType } from '@mod/types/nullable.type';

@Injectable()
export class RedisService {
    private readonly client: Redis | Cluster;

    constructor(factory: RedisFactory) {
        this.client = factory.getClient();
    }

    // Strings
    async get(key: string): Promise<NullableType<string>> {
        return this.client.get(key);
    }

    async set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | null> {
        return ttlSeconds && ttlSeconds > 0 ? this.client.set(key, value, 'EX', ttlSeconds) : this.client.set(key, value);
    }

    async del(key: string): Promise<number> {
        return this.client.del(key);
    }

    // JSON helpers
    async getJson<T extends Json>(key: string): Promise<NullableType<T>> {
        const raw = await this.get(key);
        return raw == null ? null : (JSON.parse(raw) as T);
    }

    async setJson<T extends Json>(key: string, value: T, ttlSeconds?: number): Promise<'OK' | null> {
        return this.set(key, JSON.stringify(value), ttlSeconds);
    }

    // Hashes
    async hGet(key: string, field: string): Promise<NullableType<string>> {
        return this.client.hget(key, field);
    }

    async hSet(key: string, field: string, value: string): Promise<number> {
        return this.client.hset(key, field, value);
    }

    async hGetAll(key: string): Promise<Record<string, string>> {
        return this.client.hgetall(key);
    }

    // Sets
    async sAdd(key: string, ...members: string[]): Promise<number> {
        return this.client.sadd(key, ...members);
    }

    async sMembers(key: string): Promise<string[]> {
        return this.client.smembers(key);
    }

    // TTL / existence
    async expire(key: string, ttlSeconds: number): Promise<number> {
        return this.client.expire(key, ttlSeconds);
    }

    async exists(key: string): Promise<number> {
        return this.client.exists(key);
    }

    /**
     * Atomic: set key with TTL only if it does NOT exist.
     * @returns true if the key was set, false if it already existed.
     */
    async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
        const res = await this.client.set(key, value, 'EX', ttlSec, 'NX'); // 'OK' | null
        return res === 'OK';
    }
}
