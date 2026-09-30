import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';
import { UnrecoverableError, type Job } from 'bullmq';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type { IJobResult } from '@app/types';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';
import { RedisService } from '@common/redis/redis.service';

import { BaseWorkerService } from './base-worker.service';
import { BullJobsConnectionFactory } from './bulljobs-connection.factory';
import { BullJobsService } from './bulljobs.service';

type FakeQueue = {
    name: string;
    add: jest.Mock;
    close: jest.Mock;
    getJob: jest.Mock;
    getJobCounts: jest.Mock;
    getFailed: jest.Mock;
    clean: jest.Mock;
};
type FakeWorker = {
    name: string;
    processor: (job: Job) => Promise<IJobResult>;
    handlers: Record<string, (...args: unknown[]) => void>;
    close: jest.Mock;
    pause: jest.Mock;
    resume: jest.Mock;
};

const queues: FakeQueue[] = [];
const workers: FakeWorker[] = [];

jest.mock('bullmq', () => {
    const actual = jest.requireActual('bullmq');
    return {
        ...actual,
        Queue: jest.fn().mockImplementation((name: string) => {
            const queue = {
                name,
                add: jest.fn().mockResolvedValue({ id: 'job-1' }),
                close: jest.fn(),
                getJob: jest.fn(),
                getJobCounts: jest.fn().mockResolvedValue({ waiting: 2, failed: 1 }),
                getFailed: jest.fn().mockResolvedValue([]),
                clean: jest.fn().mockResolvedValue(['a', 'b'])
            };
            queues.push(queue);
            return queue;
        }),
        Worker: jest.fn().mockImplementation((name: string, processor: (job: Job) => Promise<IJobResult>) => {
            const handlers: Record<string, (...args: unknown[]) => void> = {};
            const worker = {
                name,
                processor,
                handlers,
                on: (event: string, handler: (...args: unknown[]) => void) => {
                    handlers[event] = handler;
                },
                close: jest.fn(),
                pause: jest.fn(),
                resume: jest.fn()
            };
            workers.push(worker);
            return worker;
        })
    };
});

const REDIS: Record<string, unknown> = {
    'redis.keyPrefix': 'tenant-svc:',
    'redis.clusterEnabled': false,
    'redis.host': 'localhost',
    'redis.port': 6379,
    'redis.db': 0,
    'redis.tlsEnabled': false,
    'redis.connectTimeout': 1000,
    'redis.password': '',
    'redis.clusterNodes': ['n1:7000']
};

const configOf = (values: Record<string, unknown>) => {
    const config = mock<ConfigService>();
    config.get.mockImplementation((key: string) => values[key]);
    config.getOrThrow.mockImplementation((key: string) => values[key]);
    return config;
};

describe('BullJobs', () => {
    let redis: MockProxy<RedisService>;
    let factory: BullJobsConnectionFactory;
    const factoryWith = (values: Record<string, unknown>) =>
        new BullJobsConnectionFactory(configOf(values) as never, redis, mock<AppLoggerService>());

    beforeEach(() => {
        queues.length = 0;
        workers.length = 0;
        redis = mock<RedisService>();
        factory = factoryWith(REDIS);
    });

    describe('BullJobsConnectionFactory', () => {
        it('builds a standalone connection that never retries per request (a BullMQ requirement)', () => {
            expect(factory.createConnectionOptions()).toEqual({
                host: 'localhost',
                port: 6379,
                password: undefined,
                db: 0,
                maxRetriesPerRequest: null,
                connectTimeout: 1000
            });
            expect(factory.getKeyPrefix()).toBe('tenant-svc:bull:');
        });

        it('connects to the first cluster node, over TLS when enabled', () => {
            expect(factoryWith({ ...REDIS, 'redis.clusterEnabled': true, 'redis.tlsEnabled': true }).createConnectionOptions()).toMatchObject({
                host: 'n1',
                port: 7000,
                tls: {}
            });
            expect(factoryWith({ ...REDIS, 'redis.clusterEnabled': true, 'redis.clusterNodes': [] }).createConnectionOptions()).toMatchObject({
                host: 'localhost'
            });
        });

        it('shares the Redis client when IAM auth is on, and reports health', async () => {
            const client = {};
            redis.getClient.mockReturnValue(client as never);
            expect(factoryWith({ ...REDIS, 'redis.iamAuthEnabled': true }).createConnectionOptions()).toBe(client);

            redis.ping.mockResolvedValueOnce('PONG').mockRejectedValueOnce(new Error('down'));
            await expect(factory.isHealthy()).resolves.toBe(true);
            await expect(factory.isHealthy()).resolves.toBe(false);
        });
    });

    describe('BullJobsService', () => {
        let service: BullJobsService;

        beforeEach(() => {
            const context = mock<TenantContextService>();
            context.getTenantId.mockReturnValue('t1');
            context.getCorrelationId.mockReturnValue('corr-1');
            service = new BullJobsService(factory, mock<AppLoggerService>(), context);
        });

        it('adds jobs with the request context and retry defaults, one queue per name', async () => {
            await service.addJob('q1', 'job', { tenantId: '' } as never);
            await service.addDelayedJob('q1', 'job', { tenantId: 't2' }, 5000);
            await service.addRepeatingJob('q1', 'cron', { tenantId: 'system' }, { pattern: '5 * * * *' });

            expect(queues).toHaveLength(1);
            const calls = queues[0]!.add.mock.calls;
            expect(calls[0]![1]).toMatchObject({ tenantId: 't1', correlationId: 'corr-1' });
            expect(calls[0]![2]).toMatchObject({ attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
            expect(calls[1]![2]).toMatchObject({ delay: 5000 });
            expect(calls[2]![2]).toMatchObject({ repeat: { pattern: '5 * * * *' } });
        });

        it('reads metrics and failed jobs, retries and cleans, and closes its queues', async () => {
            await expect(service.getQueueMetrics('q2')).resolves.toEqual({ waiting: 2, active: 0, completed: 0, failed: 1, delayed: 0, paused: 0 });
            await service.getFailedJobs('q2');
            const retry = jest.fn();
            queues[0]!.getJob.mockResolvedValueOnce({ retry }).mockResolvedValueOnce(undefined);
            await service.retryJob('q2', 'job-1');
            await service.retryJob('q2', 'missing');
            expect(retry).toHaveBeenCalledTimes(1);
            await expect(service.cleanQueue('q2')).resolves.toEqual(['a', 'b']);

            await service.onModuleDestroy();
            expect(queues[0]!.close).toHaveBeenCalled();
        });
    });

    describe('BaseWorkerService', () => {
        class EchoWorker extends BaseWorkerService {
            outcome: () => Promise<IJobResult> = async () => ({ success: true });
            protected processJob(): Promise<IJobResult> {
                return this.outcome();
            }
        }

        let metrics: MockProxy<MetricsService>;
        const worker = (isWorker: boolean) => {
            metrics = mock<MetricsService>();
            const dates = mock<DateService>();
            dates.now.mockReturnValue(100);
            const echo = new EchoWorker(
                'echo',
                factory,
                configOf({ ...REDIS, 'app.isWorker': isWorker }) as never,
                mock<AppLoggerService>(),
                metrics,
                mock<TracingService>(),
                mock<TenantContextService>(),
                dates
            );
            echo.onModuleInit();
            return echo;
        };
        const job = { id: 'j1', attemptsMade: 0, data: { tenantId: 't1' } } as unknown as Job;

        it('starts a worker only in worker mode', () => {
            worker(false);
            expect(workers).toHaveLength(0);
            worker(true);
            expect(workers).toHaveLength(1);
        });

        it('processes a job, recording its outcome and attempt', async () => {
            worker(true);
            await expect(workers[0]!.processor(job)).resolves.toMatchObject({ success: true, attemptNumber: 1, processingTime: 0 });
            expect(metrics.recordQueueJobProcessed).toHaveBeenCalledWith('echo', true, 0);
        });

        it('stops retrying errors that cannot succeed, and retries the rest', async () => {
            const echo = worker(true);
            echo.outcome = async () => {
                throw new Error('Validation error: bad payload');
            };
            await expect(workers[0]!.processor(job)).rejects.toBeInstanceOf(UnrecoverableError);
            echo.outcome = async () => {
                throw new Error('timeout');
            };
            await expect(workers[0]!.processor(job)).rejects.not.toBeInstanceOf(UnrecoverableError);
            expect(metrics.recordQueueJobProcessed).toHaveBeenCalledWith('echo', false, 0);
        });

        it('logs worker events, pauses, resumes and closes', async () => {
            const echo = worker(true);
            const { handlers } = workers[0]!;
            const events: Record<string, unknown[]> = {
                completed: [job],
                failed: [job, new Error('x')],
                stalled: ['j1'],
                progress: [job, 50],
                error: [new Error('redis')]
            };
            for (const [event, args] of Object.entries(events)) {
                expect(() => handlers[event]!(...args)).not.toThrow();
            }
            await echo.pause();
            echo.resume();
            await echo.onModuleDestroy();
            expect(workers[0]!.pause).toHaveBeenCalled();
            expect(workers[0]!.close).toHaveBeenCalled();
        });
    });
});
