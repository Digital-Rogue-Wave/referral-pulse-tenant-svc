import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis, Cluster, ClusterNode, ClusterOptions, RedisOptions } from 'ioredis';
import type { RedisConfig } from '@mod/config/redis.config';
import { REDIS_IAM_AUTH_PROVIDER, RedisIamAuthProvider } from '@mod/types/app.tokens';

type RedisClient = Redis | Cluster;

function isCluster(c: RedisClient): c is Cluster {
    return typeof (c as Cluster).nodes === 'function';
}

@Injectable()
export class RedisFactory implements OnModuleDestroy {
    private client?: RedisClient;
    private subscriber?: Redis;
    private closed = false;

    constructor(
        private readonly configService: ConfigService,
        @Optional() @Inject(REDIS_IAM_AUTH_PROVIDER) private readonly iam?: RedisIamAuthProvider,
    ) {}

    getClient(): RedisClient {
        if (!this.client) this.client = this.createClient(this.readConfig());
        return this.client;
    }

    getSubscriber(): Redis | undefined {
        const cfg = this.readConfig();
        if (!cfg.subscriber.create) return undefined;
        if (!this.subscriber) this.subscriber = this.createStandalone(cfg, true);
        return this.subscriber;
    }

    // ------- config helpers (use ConfigService with infer: true) -------

    private readConfig(): RedisConfig {
        // We fetch the entire typed object via the namespace key, while still using getOrThrow.
        // If you prefer per-field, call getOrThrow on each 'redisConfig.xxx' below.
        return this.configService.getOrThrow<RedisConfig>('redisConfig', { infer: true });
    }

    // ------- create -------

    private createClient(config: RedisConfig): RedisClient {
        return config.mode === 'cluster' ? this.createCluster(config) : this.createStandalone(config);
    }

    private commonOptions(config: RedisConfig): RedisOptions {
        const tls = config.tls ? { servername: config.tlsServerName ?? config.nodes[0]?.host } : undefined;

        // Choose auth based on mode
        const username = config.authMode === 'iam' ? this.iam?.getUsername() : config.username;
        const password = config.authMode === 'iam' ? undefined : config.password;

        return {
            username,
            password,
            db: config.db,
            tls,
            enableAutoPipelining: config.enableAutoPipelining,
            lazyConnect: config.lazyConnect,
            maxRetriesPerRequest: config.maxRetriesPerRequest,
            connectTimeout: config.connectionTimeoutMs,
            retryStrategy: (attempt) => Math.min(config.reconnectBackoffMs * 2 ** (attempt - 1), 10_000),
        };
    }

    private async maybeAuthIAM(client: Redis, cfg: RedisConfig): Promise<void> {
        if (!cfg.tls || cfg.authMode !== 'iam' || !this.iam) return;
        const token = await this.iam.getToken();
        await client.auth(this.iam.getUsername(), token);
    }

    private createStandalone(cfg: RedisConfig, isSubscriber = false): Redis {
        const node = cfg.nodes[0];
        const options: RedisOptions = {
            ...this.commonOptions(cfg),
            host: node.host,
            port: node.port,
        };

        const client = new IORedis(options);

        // IAM token on first connection (and on reconnect)
        if (cfg.authMode === 'iam' && this.iam) {
            client.once('ready', () => void this.maybeAuthIAM(client, cfg));
            client.on('reconnecting', () => void this.maybeAuthIAM(client, cfg));
        }

        this.attachLoggers(client, isSubscriber ? 'redis-subscriber' : 'redis');
        return client;
    }

    private createCluster(cfg: RedisConfig): Cluster {
        const nodes: ClusterNode[] = cfg.nodes.map((n) => ({ host: n.host, port: n.port }));
        const clusterOpts: ClusterOptions = {
            redisOptions: this.commonOptions(cfg),
            scaleReads: 'slave',
            clusterRetryStrategy: (attempt) => Math.min(cfg.reconnectBackoffMs * 2 ** (attempt - 1), 10_000),
            enableAutoPipelining: cfg.enableAutoPipelining,
        };

        const cluster = new Cluster(nodes, clusterOpts);

        // IAM token for each node as it becomes ready
        if (cfg.authMode === 'iam' && this.iam) {
            cluster.on('node:ready', async (node: Redis) => { await this.maybeAuthIAM(node, cfg); });
            cluster.on('node:reconnecting', async (node: Redis) => { await this.maybeAuthIAM(node, cfg); });
        }

        this.attachLoggers(cluster, 'redis');
        return cluster;
    }

    private attachLoggers(client: RedisClient, label: string): void {
        client.on('connect', () => console.info(`[${label}] connect`));
        client.on('ready', () => console.info(`[${label}] ready`));
        client.on('reconnecting', () => console.warn(`[${label}] reconnecting`));
        client.on('error', (err) => console.error(`[${label}] error`, err));
        client.on('end', () => console.warn(`[${label}] end`));
    }

    async onModuleDestroy(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        try {
            if (this.client) {
                if (isCluster(this.client)) {
                    await this.client.quit();
                } else {
                    await (this.client as Redis).quit();
                }
            }
        } finally {
            if (this.subscriber) await this.subscriber.quit();
        }
    }
}
