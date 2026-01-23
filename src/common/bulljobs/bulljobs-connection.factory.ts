import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';
import type { AllConfigType } from '@app/config/config.type';
import { RedisService } from '@app/common/redis/redis.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';

/**
 * Factory for creating BullMQ Redis connection options
 *
 * This factory provides two modes of operation:
 * 1. **Shared connection** (default): Reuses the existing RedisService client
 *    - More efficient, single connection pool
 *    - Supports IAM authentication automatically
 *
 * 2. **Dedicated connection**: Creates new connection from config
 *    - Used when RedisService client is not compatible
 *    - Does NOT support IAM auth (will fail with ElastiCache IAM)
 *
 * BullMQ requires a dedicated connection per Queue/Worker, so we provide
 * connection options that can be used to create new connections with the
 * same configuration as the main Redis client.
 */
@Injectable()
export class BullJobsConnectionFactory {
    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly redisService: RedisService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(BullJobsConnectionFactory.name);
    }

    /**
     * Get the existing Redis client from RedisService
     * This is the preferred method as it supports IAM auth and reuses connections
     *
     * Note: BullMQ can accept an existing ioredis client via the `connection` option
     */
    getSharedConnection(): ReturnType<RedisService['getClient']> {
        return this.redisService.getClient();
    }

    /**
     * Create Redis connection options for BullMQ
     * Supports both standalone and cluster configurations
     *
     * WARNING: This does NOT support IAM authentication.
     * If using ElastiCache with IAM auth, use getSharedConnection() instead.
     */
    createConnectionOptions(): ConnectionOptions {
        const iamAuthEnabled = this.configService.get('redis.iamAuthEnabled', { infer: true });

        if (iamAuthEnabled) {
            this.logger.warn(
                'IAM auth is enabled but BullMQ connection options do not support dynamic IAM tokens. ' +
                'Using shared Redis connection instead. This is the recommended approach.',
            );
            // Return the shared client - BullMQ accepts ioredis client instances
            return this.redisService.getClient() as unknown as ConnectionOptions;
        }

        const clusterEnabled = this.configService.getOrThrow('redis.clusterEnabled', { infer: true });

        if (clusterEnabled) {
            return this.createClusterConnection();
        }

        return this.createStandaloneConnection();
    }

    private createStandaloneConnection(): ConnectionOptions {
        const host = this.configService.getOrThrow('redis.host', { infer: true });
        const port = this.configService.getOrThrow('redis.port', { infer: true });
        const password = this.configService.get('redis.password', { infer: true });
        const db = this.configService.getOrThrow('redis.db', { infer: true });
        const tlsEnabled = this.configService.getOrThrow('redis.tlsEnabled', { infer: true });
        const maxRetriesPerRequest = this.configService.get('redis.maxRetriesPerRequest', { infer: true });
        const connectTimeout = this.configService.getOrThrow('redis.connectTimeout', { infer: true });

        this.logger.debug('Creating BullMQ standalone connection', { host, port, db });

        return {
            host,
            port,
            password: password || undefined,
            db,
            maxRetriesPerRequest: maxRetriesPerRequest ?? null, // BullMQ recommends null for workers
            connectTimeout,
            ...(tlsEnabled && { tls: {} }),
        };
    }

    private createClusterConnection(): ConnectionOptions {
        const clusterNodes = this.configService.get('redis.clusterNodes', { infer: true }) || [];
        const password = this.configService.get('redis.password', { infer: true });
        const tlsEnabled = this.configService.getOrThrow('redis.tlsEnabled', { infer: true });
        const connectTimeout = this.configService.getOrThrow('redis.connectTimeout', { infer: true });

        this.logger.debug('Creating BullMQ cluster connection', { nodeCount: clusterNodes.length });

        // For cluster mode, we need to return the first node's config
        // BullMQ will handle cluster discovery
        if (clusterNodes.length > 0) {
            const [host, portStr] = clusterNodes[0].split(':');
            const port = parseInt(portStr, 10) || 6379;

            return {
                host,
                port,
                password: password || undefined,
                maxRetriesPerRequest: null,
                connectTimeout,
                ...(tlsEnabled && { tls: {} }),
            };
        }

        // Fallback to standalone config if no cluster nodes
        return this.createStandaloneConnection();
    }

    /**
     * Get the Redis key prefix for BullMQ queues
     * Ensures BullMQ keys are namespaced within the application's Redis keyspace
     */
    getKeyPrefix(): string {
        const basePrefix = this.configService.getOrThrow('redis.keyPrefix', { infer: true });
        return `${basePrefix}bull:`;
    }

    /**
     * Check if Redis connection is healthy
     */
    async isHealthy(): Promise<boolean> {
        try {
            const result = await this.redisService.ping();
            return result === 'PONG';
        } catch {
            return false;
        }
    }
}