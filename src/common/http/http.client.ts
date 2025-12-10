import { Injectable, Inject, Optional, Scope } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService, ConfigType } from '@nestjs/config';
import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';

import httpClientConfig from '@mod/config/http-client.config';
import { CircuitBreakerFactory, Breaker } from './circuit-breaker.factory';
import { HelperService } from '@mod/common/helpers/helper.service';
import { MonitoringService } from '@mod/common/monitoring/monitoring.service';
import { TenantContext, TimedAxiosRequestConfig } from '@mod/types/app.interface';
import { MachineAuthProvider } from './machine-auth.provider';
import { OutboundLoggingService } from '@mod/common/logger/outbound-logging.service';

@Injectable({ scope: Scope.REQUEST })
export class HttpClient {
    private readonly intraBreaker: Breaker<AxiosResponse<any>>;
    private readonly thirdPartyBreaker: Breaker<AxiosResponse<any>>;

    constructor(
        private readonly http: HttpService,
        helper: HelperService,
        circuitFactory: CircuitBreakerFactory,
        private readonly configService: ConfigService,
        private readonly auth: MachineAuthProvider,
        private readonly outboundLogger: OutboundLoggingService,
        @Optional() @Inject(TenantContext) private readonly tenantContext?: TenantContext,
        @Optional() private readonly metrics?: MonitoringService
    ) {
        const cfg = configService.getOrThrow<ConfigType<typeof httpClientConfig>>('httpClientConfig', { infer: true });

        const axios = http.axiosRef;
        helper.configureAxios(axios, cfg.retry.intra);

        // Request interceptor - ALWAYS add OAuth2 for internal calls
        axios.interceptors.request.use(async (requestConfig: InternalAxiosRequestConfig) => {
            const reqConfig = requestConfig as TimedAxiosRequestConfig;
            reqConfig.__start = process.hrtime.bigint();

            const isInternal = this.isInternalRequest(reqConfig.url ?? '');
            const target = isInternal ? 'internal' : 'external';

            // Add OAuth2 JWT for ALL internal service calls
            if (isInternal) {
                const tenantId = this.tenantContext?.getTenantId?.();
                const audience = this.extractHost(reqConfig);

                const outbound = await this.auth.getHeaders(audience, tenantId);

                const headers = (reqConfig.headers ?? new AxiosHeaders()) as AxiosHeaders;
                for (const [name, value] of Object.entries(outbound)) {
                    if (typeof value !== 'undefined') headers.set(name, value);
                }
                reqConfig.headers = headers;
            }

            this.outboundLogger.requestStart(target, (reqConfig.method ?? 'GET').toUpperCase(), reqConfig.url ?? '');

            return reqConfig;
        });

        // Response interceptor - metrics and logging
        axios.interceptors.response.use(
            (res) => {
                const startedAt = (res.config as TimedAxiosRequestConfig).__start;
                if (startedAt) {
                    const elapsed = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
                    const isInternal = this.isInternalRequest(res.config.url ?? '');
                    const kind = isInternal ? 'intra' : 'thirdparty';
                    const host = this.extractHost(res.config);

                    if (this.metrics) {
                        this.metrics.observeHttpClient(kind, (res.config.method ?? 'GET').toUpperCase(), host, res.status, elapsed);
                    }

                    this.outboundLogger.requestEnd(
                        isInternal ? 'internal' : 'external',
                        (res.config.method ?? 'GET').toUpperCase(),
                        res.config.url ?? '',
                        res.status,
                        elapsed * 1000
                    );
                }
                return res;
            },
            (error) => {
                const ec = error?.config as TimedAxiosRequestConfig | undefined;
                const startedAt = ec?.__start;

                if (startedAt) {
                    const elapsed = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
                    const isInternal = this.isInternalRequest(ec?.url ?? '');
                    const kind = isInternal ? 'intra' : 'thirdparty';
                    const status = error?.response?.status ?? 0;
                    const host = this.extractHost(ec);

                    if (this.metrics) {
                        this.metrics.observeHttpClient(kind, (ec?.method ?? 'GET').toUpperCase(), host, status, elapsed);
                    }

                    this.outboundLogger.requestError(
                        isInternal ? 'internal' : 'external',
                        (ec?.method ?? 'GET').toUpperCase(),
                        ec?.url ?? '',
                        elapsed * 1000,
                        error
                    );
                }
                return Promise.reject(error);
            }
        );

        // Circuit breakers for intra-service and external calls
        const intraKey = `intra:${this.safeHost(cfg.intra.baseURL)}`;
        const thirdPartyKey = `thirdparty:${this.safeHost(cfg.thirdParty.baseURL ?? 'direct')}`;

        this.intraBreaker = circuitFactory.getOrCreate(intraKey, cfg.breaker.intra);
        this.thirdPartyBreaker = circuitFactory.getOrCreate(thirdPartyKey, cfg.breaker.thirdParty);
    }

    private isInternalRequest(url: string): boolean {
        return url.includes('/internal/') || url.startsWith('internal/');
    }

    private selectBreaker(url: string): Breaker<AxiosResponse<any>> {
        return this.isInternalRequest(url) ? this.intraBreaker : this.thirdPartyBreaker;
    }

    private extractHost(config?: Pick<AxiosRequestConfig, 'baseURL' | 'url'>): string {
        try {
            const fullUrl = config?.baseURL ?? config?.url ?? '';
            return new URL(fullUrl).host || 'direct';
        } catch {
            return 'direct';
        }
    }

    private safeHost(url?: string): string {
        if (!url) return 'direct';
        try {
            return new URL(url).host;
        } catch {
            return 'direct';
        }
    }

    // Public API with circuit breaker
    async request<TResponse = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<TResponse>> {
        const breaker = this.selectBreaker(config.url ?? '');
        return breaker.fire(() => firstValueFrom(this.http.request<TResponse>(config)));
    }

    get<T = unknown>(url: string, config?: AxiosRequestConfig) {
        return this.request<T>({ ...(config ?? {}), method: 'GET', url });
    }

    post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
        return this.request<T>({ ...(config ?? {}), method: 'POST', url, data });
    }

    put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
        return this.request<T>({ ...(config ?? {}), method: 'PUT', url, data });
    }

    patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
        return this.request<T>({ ...(config ?? {}), method: 'PATCH', url, data });
    }

    delete<T = unknown>(url: string, config?: AxiosRequestConfig) {
        return this.request<T>({ ...(config ?? {}), method: 'DELETE', url });
    }
}
