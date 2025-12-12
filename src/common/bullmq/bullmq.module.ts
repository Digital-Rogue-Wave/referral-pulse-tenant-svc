import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService, ConfigType } from '@nestjs/config';
import redisConfig, { RedisMode } from '@mod/config/redis.config';
import type { ConnectionOptions } from 'bullmq';

@Module({
    imports: [
        BullModule.forRootAsync({
            imports: [ConfigModule.forFeature(redisConfig)],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const config = configService.getOrThrow<ConfigType<typeof redisConfig>>('redisConfig', { infer: true });

                // Build BullMQ connection options from Redis config
                const connection: ConnectionOptions = {
                    host: config.mode === RedisMode.Standalone ? config.nodes[0].host : undefined,
                    port: config.mode === RedisMode.Standalone ? config.nodes[0].port : undefined,
                    username: config.username,
                    password: config.password,
                    db: config.db,
                    keyPrefix: config.keyPrefix ? `${config.keyPrefix}:bull:` : 'bull:',
                    maxRetriesPerRequest: config.maxRetriesPerRequest,
                    enableReadyCheck: true,
                    enableOfflineQueue: true,
                    lazyConnect: config.lazyConnect,
                    connectTimeout: config.connectionTimeoutMs,
                    retryStrategy: (times: number) => {
                        return Math.min(times * config.reconnectBackoffMs, 3000);
                    }
                };

                // Add TLS if enabled
                if (config.tls) {
                    connection.tls = {
                        servername: config.tlsServerName,
                        rejectUnauthorized: true
                    };
                }

                // Add cluster configuration if needed
                if (config.mode === RedisMode.Cluster) {
                    // @ts-ignore - BullMQ supports cluster mode via ioredis
                    connection.cluster = {
                        nodes: config.nodes.map((node: { host: string; port: number }) => ({ host: node.host, port: node.port })),
                        options: {
                            enableReadyCheck: true,
                            maxRedirections: 16,
                            retryDelayOnFailover: 100,
                            retryDelayOnClusterDown: 300
                        }
                    };
                }

                return {
                    connection,
                    defaultJobOptions: {
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 1000
                        },
                        removeOnComplete: {
                            age: 3600, // Keep completed jobs for 1 hour
                            count: 1000 // Keep last 1000 completed jobs
                        },
                        removeOnFail: {
                            age: 86400 // Keep failed jobs for 24 hours
                        }
                    }
                };
            }
        })
    ],
    exports: [BullModule]
})
export class BullMqModule {}
