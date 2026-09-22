import { EventEmitter } from 'node:events';

import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import { DateService } from '@common/helper/date.service';
import { JsonService } from '@common/helper/json.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';

import { ElastiCacheIamAuthProvider } from './elasticache-iam-auth.provider';
import { RedisService } from './redis.service';

const created: Array<{ kind: 'standalone' | 'cluster'; args: unknown[]; client: FakeClient }> = [];

class FakeClient extends EventEmitter {
    status = 'ready';
    get = jest.fn();
    set = jest.fn();
    setex = jest.fn();
    del = jest.fn();
    ping = jest.fn().mockResolvedValue('PONG');
    quit = jest.fn();
}

jest.mock('ioredis', () => {
    const make = (kind: 'standalone' | 'cluster') =>
        jest.fn().mockImplementation((...args: unknown[]) => {
            const client = new FakeClient();
            created.push({ kind, args, client });
            setImmediate(() => client.emit('ready'));
            return client;
        });
    const Standalone = make('standalone');
    return { __esModule: true, default: Standalone, Cluster: make('cluster') };
});

const BASE_CONFIG: Record<string, unknown> = {
    'redis.keyPrefix': 'tenant-svc:',
    'redis.defaultTtl': 300,
    'redis.clusterEnabled': false,
    'redis.host': 'localhost',
    'redis.port': 6379,
    'redis.db': 0,
    'redis.maxRetriesPerRequest': 3,
    'redis.connectTimeout': 1000,
    'redis.commandTimeout': 1000,
    'redis.retryDelayMs': 100,
    'redis.maxRetryDelayMs': 1000,
    'redis.tlsEnabled': false,
    'redis.iamAuthUsername': 'svc',
    'redis.clusterNodes': ['n1:7000', 'n2'],
    'redis.password': 'secret'
};

describe('RedisService', () => {
    let config: Record<string, unknown>;
    let context: MockProxy<TenantContextService>;
    let metrics: MockProxy<MetricsService>;
    let iam: MockProxy<ElastiCacheIamAuthProvider>;
    let service: RedisService;

    const build = () => {
        const cfg = mock<ConfigService>();
        cfg.getOrThrow.mockImplementation((key: string) => config[key]);
        cfg.get.mockImplementation((key: string) => config[key]);
        const dates = mock<DateService>();
        dates.now.mockReturnValue(0);
        return new RedisService(cfg as never, context, metrics, mock<AppLoggerService>(), dates, new JsonService(metrics), iam);
    };
    const client = () => created.at(-1)!.client;

    beforeEach(async () => {
        created.length = 0;
        config = { ...BASE_CONFIG };
        context = mock<TenantContextService>();
        context.getTenantId.mockReturnValue('t1');
        metrics = mock<MetricsService>();
        iam = mock<ElastiCacheIamAuthProvider>();
        iam.isEnabled.mockReturnValue(false);
        service = build();
        await service.onModuleInit();
    });

    describe('connecting', () => {
        it('opens one standalone client with the configured password and a capped retry backoff', () => {
            expect(created).toHaveLength(1);
            const [options] = created[0]!.args as [{ password: string; retryStrategy: (times: number) => number; tls?: object }];
            expect(options.password).toBe('secret');
            expect(options.tls).toBeUndefined();
            expect(options.retryStrategy(3)).toBe(300);
            expect(options.retryStrategy(50)).toBe(1000);
        });

        it('uses an IAM auth token over TLS when ElastiCache IAM auth is on', async () => {
            iam.isEnabled.mockReturnValue(true);
            iam.getAuthToken.mockResolvedValue('iam-token');
            created.length = 0;
            await build().onModuleInit();

            const [options] = created[0]!.args as [{ password: string; username: string; tls: object }];
            expect(options).toMatchObject({ password: 'iam-token', username: 'svc', tls: {} });
            expect(iam.startTokenRefresh).toHaveBeenCalledWith('svc', 'localhost');
        });

        it('connects to a cluster when enabled', async () => {
            config['redis.clusterEnabled'] = true;
            config['redis.tlsEnabled'] = true;
            created.length = 0;
            await build().onModuleInit();

            expect(created[0]!.kind).toBe('cluster');
            const [nodes, options] = created[0]!.args as [unknown, { redisOptions: { tls: object }; clusterRetryStrategy: (n: number) => number }];
            expect(nodes).toEqual([
                { host: 'n1', port: 7000 },
                { host: 'n2', port: 6379 }
            ]);
            expect(options.redisOptions.tls).toEqual({});
            expect(options.clusterRetryStrategy(2)).toBe(200);
        });

        it('stops the IAM refresh and closes the connection on shutdown', async () => {
            await service.onModuleDestroy();
            expect(iam.stopTokenRefresh).toHaveBeenCalled();
            expect(client().quit).toHaveBeenCalled();
        });
    });

    describe('keys and values', () => {
        it('scopes keys to the tenant unless told otherwise, and round-trips JSON', async () => {
            await service.set('k', { a: 1 }, { ttl: 60 });
            expect(client().setex).toHaveBeenCalledWith('tenant-svc:t1:k', 60, '{"a":1}');

            client().get.mockResolvedValue('{"a":1}');
            await expect(service.get('k')).resolves.toEqual({ a: 1 });
            await service.get('g', { tenantScoped: false });
            expect(client().get).toHaveBeenLastCalledWith('tenant-svc:g');
        });

        it('stores raw strings without expiry when asked', async () => {
            await service.set('raw', 'v', { ttl: 0, serialize: false });
            expect(client().set).toHaveBeenCalledWith('tenant-svc:t1:raw', 'v');
            client().get.mockResolvedValue('v');
            await expect(service.get('raw', { serialize: false })).resolves.toBe('v');
            client().get.mockResolvedValue(null);
            await expect(service.get('missing')).resolves.toBeUndefined();
        });

        it('refuses a tenant-scoped key without a tenant in context', async () => {
            context.getTenantId.mockReturnValue(undefined);
            await expect(service.get('k')).rejects.toThrow('Tenant context required');
            expect(metrics.recordRedisOperation).toHaveBeenCalledWith('GET', 0, false);
        });

        it('sets only when absent, and deletes', async () => {
            client().set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
            await expect(service.setNx('lock', '1', 30)).resolves.toBe(true);
            await expect(service.setNx('lock', '1', 30)).resolves.toBe(false);
            expect(client().set).toHaveBeenCalledWith('tenant-svc:lock', '1', 'EX', 30, 'NX');

            client().del.mockResolvedValue(1);
            await expect(service.del('k', false)).resolves.toBe(true);
        });

        it('records a failed write in the metrics and rethrows', async () => {
            client().setex.mockRejectedValue(new Error('down'));
            await expect(service.set('k', 'v')).rejects.toThrow('down');
            client().del.mockRejectedValue(new Error('down'));
            await expect(service.del('k')).rejects.toThrow('down');
            client().set.mockRejectedValue(new Error('down'));
            await expect(service.setNx('k', 'v', 1)).rejects.toThrow('down');
            expect(metrics.recordRedisOperation).toHaveBeenCalledWith('SET', 0, false);
        });

        it('reports its connection', async () => {
            expect(service.isConnected()).toBe(true);
            await expect(service.ping()).resolves.toBe('PONG');
            expect(service.getClient()).toBe(client());
        });
    });
});
