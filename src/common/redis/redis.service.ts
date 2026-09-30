import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import Redis, { Cluster, RedisOptions, ClusterOptions } from 'ioredis';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type { ICacheOptions } from '@app/types';

import { DateService } from '@common/helper/date.service';
import { JsonService } from '@common/helper/json.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';

import type { AllConfigType } from '@config/config.type';

import { ElastiCacheIamAuthProvider } from './elasticache-iam-auth.provider';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private client!: Redis | Cluster;
    private readonly keyPrefix: string;
    private readonly defaultTtl: number;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly tenantContext: TenantContextService,
        private readonly metricsService: MetricsService,
        private readonly logger: AppLoggerService,
        private readonly dateService: DateService,
        private readonly jsonService: JsonService,
        private readonly iamAuthProvider: ElastiCacheIamAuthProvider
    ) {
        this.logger.setContext(RedisService.name);
        this.keyPrefix = this.configService.getOrThrow('redis.keyPrefix', {
            infer: true
        });
        this.defaultTtl = this.configService.getOrThrow('redis.defaultTtl', {
            infer: true
        });
    }

    async onModuleInit(): Promise<void> {
        const clusterEnabled = this.configService.getOrThrow('redis.clusterEnabled', { infer: true });

        if (clusterEnabled) {
            this.client = await this.createClusterClient();
        } else {
            this.client = await this.createStandaloneClient();
        }

        // Start IAM auth token refresh if enabled
        if (this.iamAuthProvider.isEnabled()) {
            const host = this.configService.getOrThrow('redis.host', { infer: true });
            const username = this.configService.getOrThrow('redis.iamAuthUsername', {
                infer: true
            });
            await this.iamAuthProvider.startTokenRefresh(username, host);
            this.logger.log('Redis service initialized with IAM authentication');
        } else {
            this.logger.log('Redis service initialized');
        }
    }

    async onModuleDestroy(): Promise<void> {
        this.iamAuthProvider.stopTokenRefresh();
        await this.client?.quit();
    }

    private async createStandaloneClient(): Promise<Redis> {
        const host = this.configService.getOrThrow('redis.host', { infer: true });
        const iamAuthEnabled = this.iamAuthProvider.isEnabled();

        // Get password from IAM auth or configuration
        let password: string | undefined;
        if (iamAuthEnabled) {
            const username = this.configService.getOrThrow('redis.iamAuthUsername', {
                infer: true
            });
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
            connectTimeout: this.configService.getOrThrow('redis.connectTimeout', {
                infer: true
            }),
            commandTimeout: this.configService.getOrThrow('redis.commandTimeout', {
                infer: true
            }),
            retryStrategy: (times) => {
                const delay = this.configService.getOrThrow('redis.retryDelayMs', {
                    infer: true
                });
                const maxDelay = this.configService.getOrThrow('redis.maxRetryDelayMs', { infer: true });
                return Math.min(times * delay, maxDelay);
            }
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
            return { host, port: parseInt(port ?? '6379', 10) };
        });

        const iamAuthEnabled = this.iamAuthProvider.isEnabled();

        // Get password from IAM auth or configuration
        let password: string | undefined;
        if (iamAuthEnabled) {
            const host = this.configService.getOrThrow('redis.host', { infer: true });
            const username = this.configService.getOrThrow('redis.iamAuthUsername', {
                infer: true
            });
            password = await this.iamAuthProvider.getAuthToken(username, host);
            this.logger.debug('Using IAM auth token for Redis cluster connection');
        } else {
            password = this.configService.get('redis.password', { infer: true }) || undefined;
        }

        const options: ClusterOptions = {
            redisOptions: {
                password,
                connectTimeout: this.configService.getOrThrow('redis.connectTimeout', {
                    infer: true
                }),
                commandTimeout: this.configService.getOrThrow('redis.commandTimeout', {
                    infer: true
                })
            },
            clusterRetryStrategy: (times) => {
                const delay = this.configService.getOrThrow('redis.retryDelayMs', {
                    infer: true
                });
                const maxDelay = this.configService.getOrThrow('redis.maxRetryDelayMs', { infer: true });
                return Math.min(times * delay, maxDelay);
            }
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

    async get<T = string>(key: string, options?: ICacheOptions): Promise<T | undefined> {
        const startTime = this.dateService.now();
        let success = true;

        try {
            const fullKey = this.buildKey(key, options?.tenantScoped !== false);
            const value = await this.client.get(fullKey);
            if (!value) {
                return undefined;
            }
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

    async setNx(key: string, value: string, ttlSeconds: number, tenantScoped = false): Promise<boolean> {
        const startTime = this.dateService.now();
        let success = true;

        try {
            const fullKey = this.buildKey(key, tenantScoped);
            const result = await this.client.set(fullKey, value, 'EX', ttlSeconds, 'NX');
            return result === 'OK';
        } catch (error) {
            success = false;
            throw error;
        } finally {
            const duration = this.dateService.now() - startTime;
            this.metricsService.recordRedisOperation('SETNX', duration, success);
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

    // ============================================================================
    // Client Access
    // ============================================================================

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
