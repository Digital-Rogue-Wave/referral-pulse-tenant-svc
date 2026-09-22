import { ConfigService } from '@nestjs/config';
import { mock } from 'jest-mock-extended';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { DomainMetrics } from './domain-metrics.service';
import { HttpMetricsService } from './http-metrics.service';
import { MessagingMetricsService } from './messaging-metrics.service';
import { MetricsService } from './metrics.service';
import { TracingService } from './tracing.service';

/**
 * Without an OpenTelemetry SDK registered, `@opentelemetry/api` hands out no-op instruments, so these specs
 * exercise the real recording code paths without exporting anything.
 */
const metricsService = (endpoint: string | undefined) => {
    const config = mock<ConfigService>();
    config.getOrThrow.mockReturnValue('tenant-svc');
    config.get.mockReturnValue(endpoint);
    const service = new MetricsService(config as never);
    service.onModuleInit();
    return service;
};

describe('Metrics', () => {
    describe('MetricsService', () => {
        it('records HTTP, Redis, JSON and queue metrics once enabled', () => {
            const metrics = metricsService('http://otel:4318/v1/metrics');

            expect(() => {
                metrics.incrementActiveHttpRequests();
                metrics.recordHttpRequest('GET', '/v1/users', 200, 12);
                metrics.recordHttpRequest('POST', '/v1/users', 500, 30);
                metrics.decrementActiveHttpRequests();
                metrics.recordRedisOperation('GET', 1, true);
                metrics.recordRedisOperation('SET', 2, false);
                metrics.recordJsonParse(1, 2048, false);
                metrics.recordJsonParse(1, 2048, true);
                metrics.recordQueueJobProcessed('event-outbox-relay', true, 5);
                metrics.recordQueueJobProcessed('event-outbox-relay', false, 5);
            }).not.toThrow();
            expect(metrics.getMeter()).toBeDefined();
        });

        it('creates custom instruments on demand', () => {
            const metrics = metricsService('http://otel:4318/v1/metrics');
            expect(metrics.createCounter('c_total', { description: 'd' })).toBeDefined();
            expect(metrics.createHistogram('h_ms', { unit: 'ms' })).toBeDefined();
            expect(metrics.createGauge('g')).toBeDefined();
        });

        it('is a no-op when no metrics endpoint is configured', () => {
            const metrics = metricsService(undefined);
            expect(() => {
                metrics.recordHttpRequest('GET', '/', 200, 1);
                metrics.recordRedisOperation('GET', 1, true);
                metrics.recordJsonParse(1, 1, false);
                metrics.recordQueueJobProcessed('q', true, 1);
            }).not.toThrow();
            expect(metrics.createCounter('still_works')).toBeDefined();
        });
    });

    it('HTTP and messaging metrics record outbound traffic and errors with the tenant', () => {
        const metrics = metricsService('http://otel:4318/v1/metrics');
        const context = mock<TenantContextService>();
        context.getTenantId.mockReturnValue('t1');
        const tracing = mock<TracingService>();
        const http = new HttpMetricsService(metrics, tracing, context, mock<AppLoggerService>());
        const messaging = new MessagingMetricsService(metrics, tracing, context, mock<AppLoggerService>());
        http.onModuleInit();
        messaging.onModuleInit();

        expect(() => {
            http.recordInboundError('GET', '/v1/users', 500, 'TypeError');
            http.recordOutboundError('GET', 'kratos', '/admin/identities', 'ECONNREFUSED');
            messaging.recordOutboundMessage('tenant-events', 'tenant.created', true, 10, 't1');
            messaging.recordOutboundMessage('tenant-events', 'tenant.created', false, 10);
            messaging.recordOutboundError('tenant-events', 'tenant.created', 'Throttling', 't1');
            messaging.recordInboundError('q', 'e', 'x');
        }).not.toThrow();
        expect(http.injectTracingHeaders({ accept: 'json' })).toMatchObject({ accept: 'json' });
    });

    it('DomainMetrics reports the outbox backlog and the business outcomes', () => {
        const metrics = metricsService('http://otel:4318/v1/metrics');
        const domain = new DomainMetrics(metrics);
        domain.onModuleInit();

        expect(() => {
            domain.outboxRun(3, 1, { pending: 5, oldestCreatedAt: new Date(Date.now() - 60_000) });
            domain.outboxRun(0, 0, { pending: 0, oldestCreatedAt: null });
            domain.tenantDeletion('deleted');
            domain.dunningEscalation('restricted');
            domain.limitRejected('seats');
            domain.erasure('completed');
        }).not.toThrow();
    });
});

describe('TracingService', () => {
    const tracing = (enabled: boolean) => {
        const config = mock<ConfigService>();
        config.getOrThrow.mockReturnValue(enabled);
        config.get.mockReturnValue(undefined);
        const service = new TracingService(config as never, mock<AppLoggerService>());
        service.onModuleInit();
        return service;
    };

    it('stays off without an endpoint, and still runs work inside a (no-op) span', async () => {
        const service = tracing(false);

        await expect(service.withSpan('job', async () => 42, { 'tenant.id': 't1' })).resolves.toBe(42);
        await expect(
            service.withSpan('job', async () => {
                throw new Error('boom');
            })
        ).rejects.toThrow('boom');
        expect(service.getCurrentTraceInfo()).toBeUndefined();
        expect(() => service.addSpanAttributes({ 'tenant.id': 't1' })).not.toThrow();
        await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
});
