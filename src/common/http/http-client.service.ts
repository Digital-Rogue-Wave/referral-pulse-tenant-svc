import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { firstValueFrom, timeout, retry } from 'rxjs';
import CircuitBreaker from 'opossum';
import { LRUCache } from 'lru-cache';
import type { AllConfigType } from '@app/config/config.type';
import type { IHttpRequestOptions, IHttpResponse, ICircuitBreakerState } from '@app/types';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { TracingService } from '@app/common/monitoring/tracing.module';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { DateService } from '@app/common/helper/date.service';

/**
 * Enhanced HTTP client using NestJS HttpModule with circuit breaker (LRU-cached).
 */
@Injectable()
export class HttpClientService implements OnModuleInit {
    private circuitBreakers: LRUCache<string, CircuitBreaker<[() => Promise<AxiosResponse>], AxiosResponse>>;
    private readonly defaultTimeout: number;
    private readonly retryAttempts: number;
    private readonly retryDelay: number;
    private readonly circuitBreakerEnabled: boolean;
    private readonly circuitBreakerConfig: {
        timeout: number;
        errorThresholdPercentage: number;
        resetTimeout: number;
        volumeThreshold: number;
    };

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly tenantContext: ClsTenantContextService,
        private readonly tracingService: TracingService,
        private readonly logger: AppLoggerService,
        private readonly dateService: DateService,
    ) {
        this.logger.setContext(HttpClientService.name);
        this.defaultTimeout = this.configService.getOrThrow('http.timeout', { infer: true });
        this.retryAttempts = this.configService.getOrThrow('http.retryAttempts', { infer: true });
        this.retryDelay = this.configService.getOrThrow('http.retryDelay', { infer: true });
        this.circuitBreakerEnabled = this.configService.getOrThrow('http.circuitBreaker.enabled', { infer: true });
        this.circuitBreakerConfig = {
            timeout: this.configService.getOrThrow('http.circuitBreaker.timeout', { infer: true }),
            errorThresholdPercentage: this.configService.getOrThrow('http.circuitBreaker.errorThresholdPercentage', { infer: true }),
            resetTimeout: this.configService.getOrThrow('http.circuitBreaker.resetTimeout', { infer: true }),
            volumeThreshold: this.configService.getOrThrow('http.circuitBreaker.volumeThreshold', { infer: true }),
        };

        const maxCacheSize = this.configService.getOrThrow('http.circuitBreaker.maxCacheSize', { infer: true });
        this.circuitBreakers = new LRUCache({
            max: maxCacheSize,
            dispose: (breaker) => {
                breaker.shutdown();
            },
        });
    }

    async onModuleInit(): Promise<void> {
        this.logger.log('HTTP Client Service initialized with LRU circuit breaker cache');
    }

    private getCircuitBreaker(serviceName: string): CircuitBreaker<[() => Promise<AxiosResponse>], AxiosResponse> {
        let breaker = this.circuitBreakers.get(serviceName);
        if (!breaker) {
            breaker = new CircuitBreaker(
                async (fn: () => Promise<AxiosResponse>) => fn(),
                {
                    timeout: this.circuitBreakerConfig.timeout,
                    errorThresholdPercentage: this.circuitBreakerConfig.errorThresholdPercentage,
                    resetTimeout: this.circuitBreakerConfig.resetTimeout,
                    volumeThreshold: this.circuitBreakerConfig.volumeThreshold,
                },
            );

            breaker.on('open', () => this.logger.warn(`Circuit breaker OPEN: ${serviceName}`));
            breaker.on('halfOpen', () => this.logger.log(`Circuit breaker HALF_OPEN: ${serviceName}`));
            breaker.on('close', () => this.logger.log(`Circuit breaker CLOSED: ${serviceName}`));

            this.circuitBreakers.set(serviceName, breaker);
        }
        return breaker;
    }

    private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...customHeaders,
        };

        try {
            const tenantId = this.tenantContext.getTenantId();
            if (tenantId) headers['x-tenant-id'] = tenantId;

            const correlationId = this.tenantContext.getCorrelationId();
            if (correlationId) headers['x-correlation-id'] = correlationId;

            const requestId = this.tenantContext.getRequestId();
            if (requestId) headers['x-request-id'] = requestId;

            const traceInfo = this.tracingService.getCurrentTraceInfo();
            if (traceInfo) {
                headers['x-b3-traceid'] = traceInfo.traceId;
                headers['x-b3-spanid'] = traceInfo.spanId;
            }
        } catch {
            // CLS context not available
        }

        return headers;
    }

    private async executeRequest<T>(
        method: string,
        url: string,
        data?: unknown,
        options?: IHttpRequestOptions,
    ): Promise<IHttpResponse<T>> {
        return this.tracingService.withSpan(`http.${method.toLowerCase()}`, async () => {
            this.tracingService.addSpanAttributes({ 'http.url': url, 'http.method': method });

            const startTime = this.dateService.now();
            const config: AxiosRequestConfig = {
                url,
                method,
                headers: this.buildHeaders(options?.headers),
                params: options?.params,
                data,
                timeout: options?.timeout || this.defaultTimeout,
            };

            const execute = async (): Promise<AxiosResponse<T>> => {
                return firstValueFrom(
                    this.httpService.request<T>(config).pipe(
                        timeout(options?.timeout || this.defaultTimeout),
                        retry({
                            count: options?.retries ?? this.retryAttempts,
                            delay: this.retryDelay,
                        }),
                    ),
                );
            };

            let response: AxiosResponse<T>;
            const skipCircuitBreaker = options?.skipCircuitBreaker || !this.circuitBreakerEnabled;

            if (skipCircuitBreaker) {
                response = await execute();
            } else {
                const serviceName = new URL(url).hostname;
                const breaker = this.getCircuitBreaker(serviceName);
                response = (await breaker.fire(execute)) as AxiosResponse<T>;
            }

            return {
                data: response.data,
                status: response.status,
                headers: response.headers as Record<string, string>,
                duration: this.dateService.now() - startTime,
            };
        });
    }

    async get<T>(url: string, options?: IHttpRequestOptions): Promise<IHttpResponse<T>> {
        return this.executeRequest<T>('GET', url, undefined, options);
    }

    async post<T, D = unknown>(url: string, data?: D, options?: IHttpRequestOptions): Promise<IHttpResponse<T>> {
        return this.executeRequest<T>('POST', url, data, options);
    }

    async put<T, D = unknown>(url: string, data?: D, options?: IHttpRequestOptions): Promise<IHttpResponse<T>> {
        return this.executeRequest<T>('PUT', url, data, options);
    }

    async patch<T, D = unknown>(url: string, data?: D, options?: IHttpRequestOptions): Promise<IHttpResponse<T>> {
        return this.executeRequest<T>('PATCH', url, data, options);
    }

    async delete<T>(url: string, options?: IHttpRequestOptions): Promise<IHttpResponse<T>> {
        return this.executeRequest<T>('DELETE', url, undefined, options);
    }

    getCircuitBreakerState(serviceName: string): ICircuitBreakerState | undefined {
        const breaker = this.circuitBreakers.get(serviceName);
        if (!breaker) return undefined;
        const stats = breaker.stats;
        return {
            name: serviceName,
            state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
            failures: stats.failures,
            successes: stats.successes,
        };
    }

    getAllCircuitBreakerStates(): ICircuitBreakerState[] {
        const states: ICircuitBreakerState[] = [];
        for (const [name, breaker] of this.circuitBreakers.entries()) {
            const stats = breaker.stats;
            states.push({
                name,
                state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
                failures: stats.failures,
                successes: stats.successes,
            });
        }
        return states;
    }

    resetCircuitBreaker(serviceName: string): void {
        const breaker = this.circuitBreakers.get(serviceName);
        if (breaker) {
            breaker.close();
            this.logger.log(`Circuit breaker reset: ${serviceName}`);
        }
    }
}
