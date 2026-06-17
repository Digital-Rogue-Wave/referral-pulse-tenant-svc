import { HttpService } from '@nestjs/axios';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { firstValueFrom, timeout, retry } from 'rxjs';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type { IHttpRequestOptions, IHttpResponse, CircuitBreakerInfo } from '@app/types';

import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TracingService } from '@common/monitoring/tracing.service';
import { CircuitBreakerService } from '@common/resilience';

import type { AllConfigType } from '@config/config.type';

/**
 * Enhanced HTTP client using NestJS HttpModule with circuit breaker.
 */
@Injectable()
export class HttpClientService implements OnModuleInit {
    private readonly defaultTimeout: number;
    private readonly retryAttempts: number;
    private readonly retryDelay: number;

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly tenantContext: TenantContextService,
        private readonly tracingService: TracingService,
        private readonly circuitBreakerService: CircuitBreakerService,
        private readonly logger: AppLoggerService,
        private readonly dateService: DateService
    ) {
        this.logger.setContext(HttpClientService.name);
        this.defaultTimeout = this.configService.getOrThrow('http.timeout', {
            infer: true
        });
        this.retryAttempts = this.configService.getOrThrow('http.retryAttempts', {
            infer: true
        });
        this.retryDelay = this.configService.getOrThrow('http.retryDelay', {
            infer: true
        });
    }

    onModuleInit(): void {
        this.logger.log('HTTP Client Service initialized');
    }

    private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...customHeaders
        };

        try {
            const tenantId = this.tenantContext.getTenantId();
            if (tenantId) {
                headers['x-tenant-id'] = tenantId;
            }

            const correlationId = this.tenantContext.getCorrelationId();
            if (correlationId) {
                headers['x-correlation-id'] = correlationId;
            }

            const requestId = this.tenantContext.getRequestId();
            if (requestId) {
                headers['x-request-id'] = requestId;
            }

            const traceInfo = this.tracingService.getCurrentTraceInfo();
            if (traceInfo) {
                headers['x-b3-traceid'] = traceInfo.traceId;
                headers['x-b3-spanid'] = traceInfo.spanId;
            }
        } catch {
            // ALS context not available
        }

        return headers;
    }

    /**
     * Execute HTTP request - OpenTelemetry HttpInstrumentation handles tracing automatically
     */
    private async executeRequest<T>(method: string, url: string, data?: unknown, options?: IHttpRequestOptions): Promise<IHttpResponse<T>> {
        const startTime = this.dateService.now();
        const config: AxiosRequestConfig = {
            url,
            method,
            headers: this.buildHeaders(options?.headers),
            params: options?.params,
            data,
            timeout: options?.timeout || this.defaultTimeout
        };

        const execute = async (): Promise<AxiosResponse<T>> => {
            return firstValueFrom(
                this.httpService.request<T>(config).pipe(
                    timeout(options?.timeout || this.defaultTimeout),
                    retry({
                        count: options?.retries ?? this.retryAttempts,
                        delay: this.retryDelay
                    })
                )
            );
        };

        let response: AxiosResponse<T>;
        const skipCircuitBreaker = options?.skipCircuitBreaker || !this.circuitBreakerService.isEnabled();

        if (skipCircuitBreaker) {
            response = await execute();
        } else {
            const serviceName = new URL(url).hostname;
            response = await this.circuitBreakerService.execute(serviceName, execute);
        }

        return {
            data: response.data,
            status: response.status,
            headers: response.headers as Record<string, string>,
            duration: this.dateService.now() - startTime
        };
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

    getCircuitBreakerState(serviceName: string): CircuitBreakerInfo | undefined {
        return this.circuitBreakerService.getState(serviceName);
    }

    getAllCircuitBreakerStates(): CircuitBreakerInfo[] {
        return this.circuitBreakerService.getAllStates();
    }

    resetCircuitBreaker(serviceName: string): void {
        this.circuitBreakerService.reset(serviceName);
    }
}
