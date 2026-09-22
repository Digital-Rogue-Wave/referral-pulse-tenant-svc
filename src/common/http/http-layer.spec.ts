import type { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { mock, MockProxy } from 'jest-mock-extended';
import { of, throwError } from 'rxjs';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import { DateService } from '@common/helper/date.service';
import { HttpOutboundInterceptor } from '@common/interceptor/http-outbound.interceptor';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { HttpMetricsService } from '@common/monitoring/http-metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';
import { CircuitBreakerService } from '@common/resilience';

import { HttpClientService } from './http-client.service';

const BREAKER: Record<string, unknown> = {
    'resilience.circuitBreaker.enabled': true,
    'resilience.circuitBreaker.failureThreshold': 5,
    'resilience.circuitBreaker.halfOpenMaxCalls': 1,
    'resilience.circuitBreaker.monitoringPeriod': 1000,
    'resilience.circuitBreaker.timeout': 1000,
    'resilience.circuitBreaker.errorThresholdPercentage': 50,
    'resilience.circuitBreaker.resetTimeout': 60_000,
    'resilience.circuitBreaker.volumeThreshold': 2,
    'resilience.circuitBreaker.maxCacheSize': 10,
    'http.timeout': 1000,
    'http.retryAttempts': 0,
    'http.retryDelay': 1,
    'http.internalServiceDomains': ['*.svc.cluster.local']
};

const configOf = (values: Record<string, unknown>) => {
    const config = mock<ConfigService>();
    config.get.mockImplementation((key: string) => values[key]);
    config.getOrThrow.mockImplementation((key: string) => values[key]);
    return config as never;
};

describe('HTTP layer', () => {
    describe('CircuitBreakerService', () => {
        it('opens after enough failures and fails fast, then can be reset', async () => {
            const breakers = new CircuitBreakerService(configOf(BREAKER), mock<AppLoggerService>());
            await breakers.onModuleInit();

            await expect(breakers.execute('kratos', async () => 'ok')).resolves.toBe('ok');
            for (let i = 0; i < 3; i++) {
                await breakers.execute('kratos', async () => Promise.reject(new Error('down'))).catch(() => undefined);
            }
            expect(breakers.getState('kratos')).toMatchObject({ name: 'kratos', state: 'OPEN' });
            await expect(breakers.execute('kratos', async () => 'ok')).rejects.toThrow();
            expect(breakers.getAllStates()).toHaveLength(1);

            breakers.reset('kratos');
            expect(breakers.getState('kratos')!.state).toBe('CLOSED');
            expect(breakers.getState('unknown')).toBeUndefined();
            breakers.resetAll();
            await breakers.onModuleDestroy();
        });

        it('passes calls straight through when disabled', async () => {
            const breakers = new CircuitBreakerService(
                configOf({ ...BREAKER, 'resilience.circuitBreaker.enabled': false }),
                mock<AppLoggerService>()
            );
            expect(breakers.isEnabled()).toBe(false);
            await expect(breakers.execute('x', async () => 1)).resolves.toBe(1);
            expect(breakers.getState('x')).toBeUndefined();
        });
    });

    describe('HttpClientService', () => {
        let http: MockProxy<HttpService>;
        let breakers: MockProxy<CircuitBreakerService>;
        let client: HttpClientService;

        beforeEach(() => {
            http = mock<HttpService>();
            http.request.mockReturnValue(of({ data: { ok: true }, status: 200, headers: {} } as AxiosResponse));
            breakers = mock<CircuitBreakerService>();
            breakers.isEnabled.mockReturnValue(true);
            breakers.execute.mockImplementation((_name, fn) => fn());
            const context = mock<TenantContextService>();
            context.getTenantId.mockReturnValue('t1');
            context.getCorrelationId.mockReturnValue('corr-1');
            context.getRequestId.mockReturnValue('req-1');
            const tracing = mock<TracingService>();
            tracing.getCurrentTraceInfo.mockReturnValue({ traceId: 'trace', spanId: 'span' });
            const dates = mock<DateService>();
            dates.now.mockReturnValue(0);
            client = new HttpClientService(http, configOf(BREAKER), context, tracing, breakers, mock<AppLoggerService>(), dates);
            client.onModuleInit();
        });

        it('sends each verb through the circuit breaker of the target host, with correlation headers', async () => {
            await expect(client.get('http://kratos:4434/admin/identities/1')).resolves.toMatchObject({ data: { ok: true }, status: 200 });
            await client.post('http://kratos:4434/x', { a: 1 });
            await client.put('http://kratos:4434/x', { a: 1 });
            await client.patch('http://kratos:4434/x', { a: 1 });
            await client.delete('http://kratos:4434/x', { headers: { 'X-Extra': '1' } });

            expect(breakers.execute).toHaveBeenCalledWith('kratos', expect.any(Function));
            const config = http.request.mock.calls[4]![0];
            expect(config).toMatchObject({
                method: 'DELETE',
                headers: expect.objectContaining({ 'x-correlation-id': 'corr-1', 'x-request-id': 'req-1', 'X-Extra': '1' })
            });
        });

        it('can skip the breaker, and propagates failures', async () => {
            http.request.mockReturnValue(throwError(() => new Error('refused')));
            await expect(client.get('http://kratos:4434/x', { skipCircuitBreaker: true, retries: 0 })).rejects.toThrow('refused');
            expect(breakers.execute).not.toHaveBeenCalled();
        });

        it('exposes the circuit breaker states for operators', () => {
            client.getCircuitBreakerState('kratos');
            client.getAllCircuitBreakerStates();
            client.resetCircuitBreaker('kratos');
            expect(breakers.reset).toHaveBeenCalledWith('kratos');
        });
    });

    describe('HttpOutboundInterceptor', () => {
        let request: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig;
        let requestError: (error: unknown) => Promise<never>;
        let response: (response: AxiosResponse) => AxiosResponse;
        let responseError: (error: AxiosError) => Promise<never>;
        let metrics: MockProxy<HttpMetricsService>;
        let context: MockProxy<TenantContextService>;

        beforeEach(() => {
            const axiosRef = {
                interceptors: {
                    request: { use: (ok: typeof request, ko: typeof requestError) => ((request = ok), (requestError = ko)) },
                    response: { use: (ok: typeof response, ko: typeof responseError) => ((response = ok), (responseError = ko)) }
                }
            };
            metrics = mock<HttpMetricsService>();
            metrics.injectTracingHeaders.mockReturnValue({ traceparent: '00-abc' });
            context = mock<TenantContextService>();
            context.getTenantId.mockReturnValue('t1');
            context.getUserId.mockReturnValue('u1');
            context.getMetadata.mockReturnValue('Bearer internal');
            const dates = mock<DateService>();
            dates.now.mockReturnValue(10);
            new HttpOutboundInterceptor({ axiosRef } as never, configOf(BREAKER), metrics, context, mock<AppLoggerService>(), dates).onModuleInit();
        });

        const config = (url: string, headers: Record<string, string> = {}) =>
            ({ url, method: 'get', headers }) as unknown as InternalAxiosRequestConfig;

        it('forwards the caller’s token only to internal services, and strips credentials for external ones', () => {
            const internal = request(config('http://campaign.svc.cluster.local/v1/x'));
            expect(internal.headers).toMatchObject({
                Authorization: 'Bearer internal',
                traceparent: '00-abc',
                'x-tenant-id': 't1',
                'x-user-id': 'u1'
            });

            const external = request(config('https://api.stripe.com/v1/x', { Authorization: 'Bearer leak', Cookie: 'c' }));
            expect(external.headers['Authorization']).toBeUndefined();
            expect(external.headers['Cookie']).toBeUndefined();

            const relative = request({ ...config('/v1/x'), baseURL: 'http://kratos:4434' } as InternalAxiosRequestConfig);
            expect(relative.headers['x-tenant-id']).toBe('t1');
        });

        it('records the outcome of every call', async () => {
            response({ status: 200, config: config('http://kratos:4434/admin') } as AxiosResponse);
            expect(metrics.recordOutboundRequest).toHaveBeenCalledWith('GET', 'kratos', '/admin', 200, expect.any(Number));

            const failure = new AxiosError('refused', 'ECONNREFUSED', config('http://kratos:4434/admin'));
            await expect(responseError(failure)).rejects.toBe(failure);
            expect(metrics.recordOutboundError).toHaveBeenCalledWith('GET', 'kratos', '/admin', 'ECONNREFUSED');

            await expect(requestError(new Error('bad config'))).rejects.toThrow('bad config');
            await expect(responseError(new AxiosError('no config'))).rejects.toBeInstanceOf(AxiosError);
        });
    });
});
