import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { Cluster, RedisOptions, ClusterOptions } from 'ioredis';
import type { AllConfigType } from '@app/config/config.type';
import type { ICacheOptions, ILockOptions, ILockResult } from '@app/types';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { MetricsService } from '@app/common/monitoring/metrics.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { DateService } from '@app/common/helper/date.service';
import { JsonService } from '@app/common/helper/json.service';
import { ElastiCacheIamAuthProvider } from './elasticache-iam-auth.provider';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private client: Redis | Cluster;
    private subscriber: Redis | Cluster;
    private readonly keyPrefix: string;
    private readonly defaultTtl: number;
    private readonly lockTtl: number;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly tenantContext: ClsTenantContextService,
        private readonly metricsService: MetricsService,
        private readonly logger: AppLoggerService,
        private readonly dateService: DateService,
        private readonly jsonService: JsonService,
        private readonly iamAuthProvider: ElastiCacheIamAuthProvider,
    ) {
        this.logger.setContext(RedisService.name);
        this.keyPrefix = this.configService.getOrThrow('redis.keyPrefix', { infer: true });
        this.defaultTtl = this.configService.getOrThrow('redis.defaultTtl', { infer: true });
        this.lockTtl = this.configService.getOrThrow('redis.lockTtl', { infer: true });
    }

    async onModuleInit(): Promise<void> {
        const clusterEnabled = this.configService.getOrThrow('redis.clusterEnabled', { infer: true });

        if (clusterEnabled) {
            this.client = await this.createClusterClient();
            this.subscriber = await this.createClusterClient();
        } else {
            this.client = await this.createStandaloneClient();
            this.subscriber = await this.createStandaloneClient();
        }

        // Start IAM auth token refresh if enabled
        if (this.iamAuthProvider.isEnabled()) {
            const host = this.configService.getOrThrow('redis.host', { infer: true });
            const username = this.configService.getOrThrow('redis.iamAuthUsername', { infer: true });
            await this.iamAuthProvider.startTokenRefresh(username, host);
            this.logger.log('Redis service initialized with IAM authentication');
        } else {
            this.logger.log('Redis service initialized');
        }
    }

    async onModuleDestroy(): Promise<void> {
        this.iamAuthProvider.stopTokenRefresh();
        await this.client?.quit();
        await this.subscriber?.quit();
    }

    private async createStandaloneClient(): Promise<Redis> {
        const host = this.configService.getOrThrow('redis.host', { infer: true });
        const iamAuthEnabled = this.iamAuthProvider.isEnabled();

        // Get password from IAM auth or configuration
        let password: string | undefined;
        if (iamAuthEnabled) {
            const username = this.configService.getOrThrow('redis.iamAuthUsername', { infer: true });
            password = await this.iamAuthProvider.getAuthToken(username, host);
            this.logger.debug('Using IAM auth token for Redis connection');
        } else {
            password = this.configService.get('redis.password', { infer: true }) || undefined;
        }

        const options: RedisOptions = {
            host,
            port: this.configService.getOrThrow('redis.port', { infer: true }),
            password,
            db: this.configService.getOrThrow('redis.db', { infer: true }),
            maxRetriesPerRequest: this.configService.getOrThrow('redis.maxRetriesPerRequest', { infer: true }),
            connectTimeout: this.configService.getOrThrow('redis.connectTimeout', { infer: true }),
            commandTimeout: this.configService.getOrThrow('redis.commandTimeout', { infer: true }),
            retryStrategy: (times) => {
                const delay = this.configService.getOrThrow('redis.retryDelayMs', { infer: true });
                const maxDelay = this.configService.getOrThrow('redis.maxRetryDelayMs', { infer: true });
                return Math.min(times * delay, maxDelay);
            },
        };

        // IAM auth requires TLS
        if (this.configService.getOrThrow('redis.tlsEnabled', { infer: true }) || iamAuthEnabled) {
            options.tls = {};
        }

        // For IAM auth, set username
        if (iamAuthEnabled) {
            options.username = this.configService.getOrThrow('redis.iamAuthUsername', { infer: true });
        }

        const client = new Redis(options);
        await new Promise<void>((resolve, reject) => {
            client.once('ready', resolve);
            client.once('error', reject);
        });
        return client;
    }

    private async createClusterClient(): Promise<Cluster> {
        const clusterNodes = this.configService.get('redis.clusterNodes', { infer: true }) || [];
        const nodes = clusterNodes.map((node: string) => {
            const [host, port] = node.split(':');
            return { host, port: parseInt(port, 10) || 6379 };
        });

        const iamAuthEnabled = this.iamAuthProvider.isEnabled();

        // Get password from IAM auth or configuration
        let password: string | undefined;
        if (iamAuthEnabled) {
            const host = this.configService.getOrThrow('redis.host', { infer: true });
            const username = this.configService.getOrThrow('redis.iamAuthUsername', { infer: true });
            password = await this.iamAuthProvider.getAuthToken(username, host);
            this.logger.debug('Using IAM auth token for Redis cluster connection');
        } else {
            password = this.configService.get('redis.password', { infer: true }) || undefined;
        }

        const options: ClusterOptions = {
            redisOptions: {
                password,
                connectTimeout: this.configService.getOrThrow('redis.connectTimeout', { infer: true }),
                commandTimeout: this.configService.getOrThrow('redis.commandTimeout', { infer: true }),
            },
            clusterRetryStrategy: (times) => {
                const delay = this.configService.getOrThrow('redis.retryDelayMs', { infer: true });
                const maxDelay = this.configService.getOrThrow('redis.maxRetryDelayMs', { infer: true });
                return Math.min(times * delay, maxDelay);
            },
        };

        // IAM auth requires TLS
        if (this.configService.getOrThrow('redis.tlsEnabled', { infer: true }) || iamAuthEnabled) {
            options.redisOptions!.tls = {};
        }

        // For IAM auth, set username
        if (iamAuthEnabled) {
            options.redisOptions!.username = this.configService.getOrThrow('redis.iamAuthUsername', { infer: true });
        }

        const cluster = new Cluster(nodes, options);
        await new Promise<void>((resolve, reject) => {
            cluster.once('ready', resolve);
            cluster.once('error', reject);
        });
        return cluster;
    }

    private buildKey(key: string, tenantScoped = true): string {
        if (tenantScoped) {
            const tenantId = this.tenantContext.getTenantId();
            if (!tenantId) {
                throw new Error('Tenant context required for tenant-scoped operations');
            }
            return `${this.keyPrefix}${tenantId}:${key}`;
        }
        return `${this.keyPrefix}${key}`;
    }

    async get<T = string>(key: string, options?: ICacheOptions): Promise<T | null> {
        const startTime = this.dateService.now();
        let success = true;

        try {
            const fullKey = this.buildKey(key, options?.tenantScoped !== false);
            const value = await this.client.get(fullKey);
            if (!value) return null;
            if (options?.serialize !== false) {
                return this.jsonService.safeParse<T>(value) ?? (value as unknown as T);
            }
            return value as unknown as T;
        } catch (error) {
            success = false;
            throw error;
        } finally {
            const duration = this.dateService.now() - startTime;
            this.metricsService.recordRedisOperation('GET', duration, success);
        }
    }

    async set<T = string>(key: string, value: T, options?: ICacheOptions): Promise<void> {
        const startTime = this.dateService.now();
        let success = true;

        try {
            const fullKey = this.buildKey(key, options?.tenantScoped !== false);
            const ttl = options?.ttl ?? this.defaultTtl;
            const serialized = options?.serialize !== false ? this.jsonService.stringify(value) : String(value);
            if (ttl > 0) {
                await this.client.setex(fullKey, ttl, serialized);
            } else {
                await this.client.set(fullKey, serialized);
            }
        } catch (error) {
            success = false;
            throw error;
        } finally {
            const duration = this.dateService.now() - startTime;
            this.metricsService.recordRedisOperation('SET', duration, success);
        }
    }

    async del(key: string, tenantScoped = true): Promise<boolean> {
        const startTime = this.dateService.now();
        let success = true;

        try {
            const fullKey = this.buildKey(key, tenantScoped);
            const result = await this.client.del(fullKey);
            return result > 0;
        } catch (error) {
            success = false;
            throw error;
        } finally {
            const duration = this.dateService.now() - startTime;
            this.metricsService.recordRedisOperation('DEL', duration, success);
        }
    }

    async exists(key: string, tenantScoped = true): Promise<boolean> {
        const fullKey = this.buildKey(key, tenantScoped);
        const result = await this.client.exists(fullKey);
        return result > 0;
    }

    async expire(key: string, seconds: number, tenantScoped = true): Promise<boolean> {
        const fullKey = this.buildKey(key, tenantScoped);
        const result = await this.client.expire(fullKey, seconds);
        return result === 1;
    }

    async ttl(key: string, tenantScoped = true): Promise<number> {
        const fullKey = this.buildKey(key, tenantScoped);
        return this.client.ttl(fullKey);
    }

    async incr(key: string, tenantScoped = true): Promise<number> {
        const fullKey = this.buildKey(key, tenantScoped);
        return this.client.incr(fullKey);
    }

    async incrBy(key: string, amount: number, tenantScoped = true): Promise<number> {
        const fullKey = this.buildKey(key, tenantScoped);
        return this.client.incrby(fullKey, amount);
    }

    async getOrSet<T>(key: string, factory: () => Promise<T>, options?: ICacheOptions): Promise<T> {
        const cached = await this.get<T>(key, options);
        if (cached !== null) return cached;
        const value = await factory();
        await this.set(key, value, options);
        return value;
    }

    async delPattern(pattern: string, tenantScoped = true): Promise<number> {
        const fullPattern = this.buildKey(pattern, tenantScoped);
        const keys = await this.client.keys(fullPattern);
        if (keys.length === 0) return 0;
        return this.client.del(...keys);
    }

    async acquireLock(lockName: string, options?: ILockOptions): Promise<ILockResult> {
        const startTime = this.dateService.now();
        let success = true;

        try {
            const lockKey = this.buildKey(`lock:${lockName}`, true);
            const lockId = `${this.dateService.now()}-${Math.random().toString(36).slice(2)}`;
            const ttl = options?.ttl ?? this.lockTtl;
            const retryCount = options?.retryCount ?? 3;
            const retryDelay = options?.retryDelay ?? 100;

            for (let attempt = 0; attempt <= retryCount; attempt++) {
                const acquired = await this.client.set(lockKey, lockId, 'PX', ttl, 'NX');
                if (acquired === 'OK') {
                    return {
                        acquired: true,
                        lockId,
                        release: async () => {
                            const currentValue = await this.client.get(lockKey);
                            if (currentValue === lockId) {
                                await this.client.del(lockKey);
                            }
                        },
                    };
                }
                if (attempt < retryCount) {
                    await new Promise((r) => setTimeout(r, retryDelay));
                }
            }

            success = false; // Failed to acquire lock
            return { acquired: false, release: async () => {} };
        } catch (error) {
            success = false;
            throw error;
        } finally {
            const duration = this.dateService.now() - startTime;
            this.metricsService.recordRedisOperation('LOCK', duration, success);
        }
    }

    async withLock<T>(lockName: string, fn: () => Promise<T>, options?: ILockOptions): Promise<T> {
        const lock = await this.acquireLock(lockName, options);
        if (!lock.acquired) {
            throw new Error(`Failed to acquire lock: ${lockName}`);
        }
        try {
            return await fn();
        } finally {
            await lock.release();
        }
    }

    async hset(key: string, field: string, value: unknown, tenantScoped = true): Promise<void> {
        const fullKey = this.buildKey(key, tenantScoped);
        await this.client.hset(fullKey, field, this.jsonService.stringify(value));
    }

    async hget<T>(key: string, field: string, tenantScoped = true): Promise<T | null> {
        const fullKey = this.buildKey(key, tenantScoped);
        const value = await this.client.hget(fullKey, field);
        if (!value) return null;
        return this.jsonService.safeParse<T>(value) ?? (value as unknown as T);
    }

    async hgetall<T>(key: string, tenantScoped = true): Promise<Record<string, T>> {
        const fullKey = this.buildKey(key, tenantScoped);
        const hash = await this.client.hgetall(fullKey);
        const result: Record<string, T> = {};
        for (const [field, value] of Object.entries(hash)) {
            result[field] = this.jsonService.safeParse<T>(value) ?? (value as unknown as T);
        }
        return result;
    }

    async hdel(key: string, field: string, tenantScoped = true): Promise<boolean> {
        const fullKey = this.buildKey(key, tenantScoped);
        const result = await this.client.hdel(fullKey, field);
        return result > 0;
    }

    async publish<T>(channel: string, data: T): Promise<number> {
        const message = this.jsonService.stringify({
            channel,
            data,
            timestamp: this.dateService.nowISO(),
            tenantId: this.tenantContext.getTenantId(),
        });
        return this.client.publish(channel, message);
    }

    async subscribe(channel: string, handler: (message: unknown) => void): Promise<void> {
        await this.subscriber.subscribe(channel);
        this.subscriber.on('message', (ch, message) => {
            if (ch === channel) {
                const parsed = this.jsonService.safeParse(message);
                handler(parsed ?? message);
            }
        });
    }

    async unsubscribe(channel: string): Promise<void> {
        await this.subscriber.unsubscribe(channel);
    }

    getClient(): Redis | Cluster {
        return this.client;
    }

    isConnected(): boolean {
        return this.client.status === 'ready';
    }

    async ping(): Promise<string> {
        return this.client.ping();
    }
}
