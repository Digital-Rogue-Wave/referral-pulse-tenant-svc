import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { AllConfigType } from '@app/config/config.type';
import { HttpMetricsService } from '@app/common/monitoring/http-metrics.service';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { DateService } from '@app/common/helper/date.service';

/**
 * HTTP Outbound Interceptor
 *
 * Handles all outbound HTTP calls with:
 * - Metrics and tracing via HttpMetricsService
 * - JWT token forwarding (internal vs external services)
 * - Tenant context propagation
 * - Request/response logging with emojis
 *
 * Internal services (same cluster): JWT + tenant context forwarded
 * External services: Only tracing headers + tenant context (no JWT)
 */
@Injectable()
export class HttpOutboundInterceptor implements OnModuleInit {
    private readonly internalServiceDomains: string[];

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly httpMetrics: HttpMetricsService,
        private readonly tenantContext: ClsTenantContextService,
        private readonly logger: AppLoggerService,
        private readonly dateService: DateService,
    ) {
        this.logger.setContext(HttpOutboundInterceptor.name);

        // Get internal service domains from config (e.g., ['*.svc.cluster.local', 'internal.example.com'])
        this.internalServiceDomains = this.configService.get('http.internalServiceDomains', { infer: true }) || [];
    }

    async onModuleInit(): Promise<void> {
        const axiosInstance = this.httpService.axiosRef;

        // Request interceptor
        axiosInstance.interceptors.request.use(
            (config) => this.handleRequest(config),
            (error) => this.handleRequestError(error),
        );

        // Response interceptor
        axiosInstance.interceptors.response.use(
            (response) => this.handleResponse(response),
            (error) => this.handleResponseError(error),
        );

        this.logger.log('🌐 HTTP Outbound Interceptor initialized');
    }

    /**
     * Handle outbound request - add headers, metrics, tracing
     */
    private handleRequest(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
        const url = this.buildFullUrl(config);
        const startTime = this.dateService.now();

        // Store start time in config for later duration calculation
        (config as any).__startTime = startTime;

        const isInternal = this.isInternalService(url);
        const serviceName = this.extractServiceName(url);

        // Add tracing headers (always included)
        // Tracing spans are created automatically by OpenTelemetry's AxiosInstrumentation
        const tracingHeaders = this.httpMetrics.injectTracingHeaders();
        Object.assign(config.headers, tracingHeaders);

        // Add tenant context headers (always included)
        const tenantId = this.tenantContext.getTenantId();
        const userId = this.tenantContext.getUserId();
        if (tenantId) config.headers['x-tenant-id'] = tenantId;
        if (userId) config.headers['x-user-id'] = userId;

        // Handle JWT forwarding based on internal vs external
        if (isInternal) {
            // Internal service: forward JWT token if present
            const authHeader = this.tenantContext.getMetadata<string>('authHeader');
            if (authHeader) {
                config.headers['Authorization'] = authHeader;
                this.logger.debug(`🔐 Forwarding JWT to internal service: ${serviceName}`, {
                    url,
                    serviceName,
                    tenantId,
                });
            }
        } else {
            // External service: strip JWT token for security
            delete config.headers['Authorization'];
            delete config.headers['Cookie'];
            this.logger.debug(`🌍 External service call (JWT stripped): ${serviceName}`, {
                url,
                serviceName,
                tenantId,
            });
        }

        this.logger.debug(`📤 Outbound HTTP ${config.method?.toUpperCase()}: ${url}`, {
            method: config.method?.toUpperCase(),
            url,
            serviceName,
            isInternal,
            tenantId,
        });

        return config;
    }

    /**
     * Handle request errors (before sending)
     */
    private handleRequestError(error: any): Promise<never> {
        this.logger.error('❌ HTTP Request preparation failed', error);
        return Promise.reject(error);
    }

    /**
     * Handle successful response
     */
    private handleResponse(response: AxiosResponse): AxiosResponse {
        const config = response.config as InternalAxiosRequestConfig & { __startTime?: number };
        const url = this.buildFullUrl(config);
        const startTime = config.__startTime || this.dateService.now();
        const duration = this.dateService.now() - startTime;
        const serviceName = this.extractServiceName(url);
        const method = config.method?.toUpperCase() || 'GET';
        const tenantId = this.tenantContext.getTenantId();

        // Record metrics
        try {
            const parsedUrl = new URL(url);
            this.httpMetrics.recordOutboundRequest(
                method,
                parsedUrl.hostname,
                parsedUrl.pathname,
                response.status,
                duration,
            );
        } catch (error) {
            // URL parsing failed, skip metrics
        }

        this.logger.debug(`✅ HTTP ${method} ${response.status}: ${url} (${duration}ms)`, {
            method,
            url,
            serviceName,
            status: response.status,
            duration,
            tenantId,
        });

        return response;
    }

    /**
     * Handle error response
     */
    private handleResponseError(error: AxiosError): Promise<never> {
        const config = error.config as InternalAxiosRequestConfig & { __startTime?: number };
        const url = config ? this.buildFullUrl(config) : 'unknown';
        const startTime = config?.__startTime || this.dateService.now();
        const duration = this.dateService.now() - startTime;
        const serviceName = this.extractServiceName(url);
        const method = config?.method?.toUpperCase() || 'GET';
        const status = error.response?.status || 0;
        const tenantId = this.tenantContext.getTenantId();

        // Record metrics
        try {
            const parsedUrl = new URL(url);
            this.httpMetrics.recordOutboundRequest(
                method,
                parsedUrl.hostname,
                parsedUrl.pathname,
                status,
                duration,
            );

            // Record error metrics
            this.httpMetrics.recordOutboundError(
                method,
                parsedUrl.hostname,
                parsedUrl.pathname,
                error.code || 'UNKNOWN_ERROR',
            );
        } catch (parseError) {
            // URL parsing failed, skip metrics
        }

        this.logger.error(`❌ HTTP ${method} failed: ${url} (${duration}ms)`, error.stack, {
            method,
            url,
            serviceName,
            status,
            errorMessage: error.message,
            code: error.code,
            duration,
            tenantId,
        });

        return Promise.reject(error);
    }

    /**
     * Check if URL is an internal service (same cluster/namespace)
     */
    private isInternalService(url: string): boolean {
        try {
            const hostname = new URL(url).hostname;

            // Check against configured internal domains
            return this.internalServiceDomains.some((pattern) => {
                // Support wildcard patterns like '*.svc.cluster.local'
                const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
                return regex.test(hostname);
            });
        } catch {
            // If URL parsing fails, assume external for security
            return false;
        }
    }

    /**
     * Extract service name from URL for metrics
     */
    private extractServiceName(url: string): string {
        try {
            const hostname = new URL(url).hostname;
            // For k8s services like 'campaign-service.default.svc.cluster.local', return 'campaign-service'
            return hostname.split('.')[0];
        } catch {
            return 'unknown';
        }
    }

    /**
     * Build full URL from Axios config
     */
    private buildFullUrl(config: InternalAxiosRequestConfig): string {
        if (!config.url) return 'unknown';

        // If URL is already absolute, return it
        if (config.url.startsWith('http://') || config.url.startsWith('https://')) {
            return config.url;
        }

        // Build URL from baseURL + url
        const baseURL = config.baseURL || '';
        return `${baseURL}${config.url}`;
    }
}