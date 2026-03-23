import { Injectable, OnModuleInit } from '@nestjs/common';

import { Counter, Histogram, ObservableGauge, Span, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { LRUCache } from 'lru-cache';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';

import { AppLoggerService } from '@common/logging/app-logger.service';

import { MetricsService } from './metrics.service';
import { TracingService } from './tracing.service';

/**
 * Service for recording HTTP metrics and tracing (inbound and outbound)
 * Provides a clean API for tracking HTTP communication with full observability
 * Supports multi-tenancy with automatic tenant context propagation
 *
 * Note: OpenTelemetry's HttpInstrumentation provides automatic HTTP spans/metrics.
 * This service adds business-specific metrics with tenant context and custom labels.
 */
@Injectable()
export class HttpMetricsService implements OnModuleInit {
    // Pre-initialized outbound metrics (reused across all requests)
    private outboundRequestsCounter!: Counter;
    private outboundDurationHistogram!: Histogram;
    private outboundErrorsCounter!: Counter;
    private outboundTimeoutsCounter!: Counter;
    private outboundRetriesCounter!: Counter;
    private outboundCircuitBreakerTripsCounter!: Counter;
    private outboundRequestSizeHistogram!: Histogram;
    private outboundResponseSizeHistogram!: Histogram;

    // Pre-initialized inbound metrics
    private inboundRequestSizeHistogram!: Histogram;
    private inboundResponseSizeHistogram!: Histogram;
    private inboundErrorsCounter!: Counter;

    // Circuit breaker state gauge
    private circuitBreakerStateGauge!: ObservableGauge;

    // Connection pool gauges
    private connectionPoolActiveGauge!: ObservableGauge;
    private connectionPoolIdleGauge!: ObservableGauge;
    private connectionPoolWaitingGauge!: ObservableGauge;

    // Circuit breaker state tracking (LRU cache for bounded memory)
    private readonly circuitBreakerStates = new LRUCache<string, number>({
        max: 100, // Max 100 hosts tracked
        ttl: 1000 * 60 * 60, // 1 hour TTL
    });

    // Connection pool stats tracking (LRU cache)
    private readonly connectionPoolStats = new LRUCache<string, { active: number; idle: number; waiting: number }>({
        max: 100,
        ttl: 1000 * 60 * 5, // 5 min TTL
    });

    constructor(
        private readonly metricsService: MetricsService,
        private readonly tracingService: TracingService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(HttpMetricsService.name);
    }

    onModuleInit(): void {
        this.initializeOutboundMetrics();
        this.initializeInboundMetrics();
        this.logger.log('HTTP Metrics Service initialized');
    }

    private initializeOutboundMetrics(): void {
        const meter = this.metricsService.getMeter();

        this.outboundRequestsCounter = meter.createCounter('http.outbound.requests.total', {
            description: 'Total number of outbound HTTP requests',
        });

        this.outboundDurationHistogram = this.metricsService.createHistogram('http.outbound.duration', {
            description: 'Outbound HTTP request duration in milliseconds',
            unit: 'ms',
        });

        this.outboundErrorsCounter = meter.createCounter('http.outbound.errors.total', {
            description: 'Total number of outbound HTTP errors',
        });

        this.outboundTimeoutsCounter = meter.createCounter('http.outbound.timeouts.total', {
            description: 'Total number of outbound HTTP timeouts',
        });

        this.outboundRetriesCounter = meter.createCounter('http.outbound.retries.total', {
            description: 'Total number of outbound HTTP retry attempts',
        });

        this.outboundCircuitBreakerTripsCounter = meter.createCounter('http.outbound.circuit_breaker.trips.total', {
            description: 'Total number of circuit breaker trips',
        });

        this.outboundRequestSizeHistogram = this.metricsService.createHistogram('http.outbound.request.size', {
            description: 'Size of outbound HTTP request body in bytes',
            unit: 'bytes',
        });

        this.outboundResponseSizeHistogram = this.metricsService.createHistogram('http.outbound.response.size', {
            description: 'Size of outbound HTTP response body in bytes',
            unit: 'bytes',
        });

        // Circuit breaker state observable gauge
        this.circuitBreakerStateGauge = this.metricsService.createGauge('http.outbound.circuit_breaker.state', {
            description: 'HTTP circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)',
        });
        this.circuitBreakerStateGauge.addCallback((result) => {
            for (const [host, stateValue] of this.circuitBreakerStates.entries()) {
                result.observe(stateValue, { host });
            }
        });

        // Connection pool observable gauges
        this.connectionPoolActiveGauge = this.metricsService.createGauge('http.connection_pool.active', {
            description: 'Number of active HTTP connections in pool',
        });
        this.connectionPoolActiveGauge.addCallback((result) => {
            for (const [host, stats] of this.connectionPoolStats.entries()) {
                result.observe(stats.active, { host });
            }
        });

        this.connectionPoolIdleGauge = this.metricsService.createGauge('http.connection_pool.idle', {
            description: 'Number of idle HTTP connections in pool',
        });
        this.connectionPoolIdleGauge.addCallback((result) => {
            for (const [host, stats] of this.connectionPoolStats.entries()) {
                result.observe(stats.idle, { host });
            }
        });

        this.connectionPoolWaitingGauge = this.metricsService.createGauge('http.connection_pool.waiting', {
            description: 'Number of requests waiting for HTTP connection',
        });
        this.connectionPoolWaitingGauge.addCallback((result) => {
            for (const [host, stats] of this.connectionPoolStats.entries()) {
                result.observe(stats.waiting, { host });
            }
        });
    }

    private initializeInboundMetrics(): void {
        this.inboundRequestSizeHistogram = this.metricsService.createHistogram('http.inbound.request.size', {
            description: 'Size of inbound HTTP request body in bytes',
            unit: 'bytes',
        });

        this.inboundResponseSizeHistogram = this.metricsService.createHistogram('http.inbound.response.size', {
            description: 'Size of inbound HTTP response body in bytes',
            unit: 'bytes',
        });

        this.inboundErrorsCounter = this.metricsService.createCounter('http.inbound.errors.total', {
            description: 'Total number of inbound HTTP errors',
        });
    }

    // ==================== Inbound HTTP Metrics ====================

    /**
     * Record an inbound HTTP request
     */
    recordInboundRequest(
        method: string,
        route: string,
        statusCode: number,
        durationMs: number,
        requestSizeBytes?: number,
        responseSizeBytes?: number,
    ): void {
        // Use the existing MetricsService method for consistency
        this.metricsService.recordHttpRequest(method, route, statusCode, durationMs);

        // Record request/response sizes if provided (using pre-initialized histograms)
        if (requestSizeBytes !== undefined) {
            this.inboundRequestSizeHistogram.record(requestSizeBytes, {
                method,
                route,
            });
        }

        if (responseSizeBytes !== undefined) {
            this.inboundResponseSizeHistogram.record(responseSizeBytes, {
                method,
                route,
            });
        }
    }

    /**
     * Record inbound HTTP error
     */
    recordInboundError(method: string, route: string, statusCode: number, errorType: string): void {
        this.inboundErrorsCounter.add(1, {
            method,
            route,
            status_code: statusCode.toString(),
            error_type: errorType,
        });
    }

    /**
     * Increment active inbound HTTP requests
     */
    incrementInboundActiveRequests(): void {
        this.metricsService.incrementActiveHttpRequests();
    }

    /**
     * Decrement active inbound HTTP requests
     */
    decrementInboundActiveRequests(): void {
        this.metricsService.decrementActiveHttpRequests();
    }

    // ==================== Outbound HTTP Metrics ====================

    /**
     * Record an outbound HTTP request (uses pre-initialized metrics)
     */
    recordOutboundRequest(
        method: string,
        host: string,
        path: string,
        statusCode: number,
        durationMs: number,
        requestSizeBytes?: number,
        responseSizeBytes?: number,
    ): void {
        this.outboundRequestsCounter.add(1, {
            method,
            host,
            path,
            status_code: statusCode.toString(),
            success: (statusCode >= 200 && statusCode < 300).toString(),
        });

        this.outboundDurationHistogram.record(durationMs, {
            method,
            host,
            status_code: statusCode.toString(),
        });

        // Record request/response sizes if provided
        if (requestSizeBytes !== undefined) {
            this.outboundRequestSizeHistogram.record(requestSizeBytes, {
                method,
                host,
            });
        }

        if (responseSizeBytes !== undefined) {
            this.outboundResponseSizeHistogram.record(responseSizeBytes, {
                method,
                host,
            });
        }
    }

    /**
     * Record outbound HTTP error
     */
    recordOutboundError(method: string, host: string, path: string, errorType: string): void {
        this.outboundErrorsCounter.add(1, {
            method,
            host,
            path,
            error_type: errorType,
        });
    }

    /**
     * Record outbound HTTP timeout
     */
    recordOutboundTimeout(method: string, host: string, path: string, timeoutMs: number): void {
        this.outboundTimeoutsCounter.add(1, {
            method,
            host,
            path,
            timeout: timeoutMs.toString(),
        });
    }

    /**
     * Record outbound HTTP retry
     */
    recordOutboundRetry(method: string, host: string, path: string, attemptNumber: number, reason: string): void {
        this.outboundRetriesCounter.add(1, {
            method,
            host,
            path,
            attempt: attemptNumber.toString(),
            reason,
        });
    }

    /**
     * Record outbound circuit breaker state (uses LRU cache for state tracking)
     */
    recordOutboundCircuitBreakerState(host: string, state: 'CLOSED' | 'HALF_OPEN' | 'OPEN'): void {
        this.logger.log(`Circuit breaker state changed: ${host} - ${state}`);
        const stateValue = state === 'CLOSED' ? 0 : state === 'HALF_OPEN' ? 1 : 2;
        this.circuitBreakerStates.set(host, stateValue);
    }

    /**
     * Record outbound circuit breaker trip
     */
    recordOutboundCircuitBreakerTrip(host: string, reason: string): void {
        this.logger.warn(`Circuit breaker tripped: ${host} - ${reason}`);
        this.outboundCircuitBreakerTripsCounter.add(1, { host, reason });
    }

    /**
     * Track active outbound HTTP requests
     */
    private activeOutboundRequests: Map<string, number> = new Map();

    /**
     * Increment active outbound HTTP requests
     */
    incrementOutboundActiveRequests(host: string): void {
        const current = this.activeOutboundRequests.get(host) || 0;
        this.activeOutboundRequests.set(host, current + 1);
    }

    /**
     * Decrement active outbound HTTP requests
     */
    decrementOutboundActiveRequests(host: string): void {
        const current = this.activeOutboundRequests.get(host) || 0;
        if (current > 0) {
            this.activeOutboundRequests.set(host, current - 1);
        }
    }

    /**
     * Get active outbound requests count
     */
    getActiveOutboundRequests(host: string): number {
        return this.activeOutboundRequests.get(host) || 0;
    }

    // ==================== Connection Pool Metrics ====================

    /**
     * Record HTTP connection pool stats
     */
    /**
     * Record HTTP connection pool stats (uses LRU cache for state tracking)
     */
    recordConnectionPoolStats(host: string, active: number, idle: number, waiting: number): void {
        this.connectionPoolStats.set(host, { active, idle, waiting });
    }

    // ==================== Inbound HTTP Tracing ====================

    /**
     * Trace an inbound HTTP request with automatic span management
     * Use this to wrap HTTP request handlers
     */
    async traceInboundRequest<T>(
        method: string,
        route: string,
        handler: (span: Span) => Promise<T>,
        metadata?: Record<string, string | number>,
    ): Promise<T> {
        const startTime = Date.now();

        return this.tracingService.withSpan(`HTTP ${method} ${route}`, async (span: Span) => {
            const tenantId = this.tenantContext.getTenantId();

            // Set span attributes including tenant context
            span.setAttributes({
                'http.method': method,
                'http.route': route,
                'http.flavor': '1.1',
                'span.kind': 'server',
                'tenant.id': tenantId || 'unknown',
                ...metadata,
            });

            try {
                this.incrementInboundActiveRequests();
                const result = await handler(span);
                const durationMs = Date.now() - startTime;

                // Assume success if no error thrown
                span.setAttribute('http.status_code', 200);
                this.recordInboundRequest(method, route, 200, durationMs);

                span.setStatus({ code: SpanStatusCode.OK });
                return result;
            } catch (error) {
                const durationMs = Date.now() - startTime;
                const statusCode = (error as { statusCode?: number })?.statusCode ?? 500;
                const errorType = error instanceof Error ? error.constructor.name : 'Unknown';

                // Record error metrics
                span.setAttribute('http.status_code', statusCode);
                this.recordInboundRequest(method, route, statusCode, durationMs);
                this.recordInboundError(method, route, statusCode, errorType);

                // Record exceptions in span
                span.recordException(error as Error);
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : 'Unknown error',
                });

                throw error;
            } finally {
                this.decrementInboundActiveRequests();
            }
        });
    }

    // ==================== Outbound HTTP Tracing ====================

    /**
     * Trace an outbound HTTP request with automatic span management
     * Use this to wrap HTTP client calls
     */
    async traceOutboundRequest<T>(
        method: string,
        url: string,
        caller: (span: Span) => Promise<{
            data: T;
            statusCode: number;
            headers?: Record<string, string>;
        }>,
        metadata?: Record<string, string | number>,
    ): Promise<T> {
        const startTime = Date.now();
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname;
        const path = parsedUrl.pathname;

        return this.tracingService.withSpan(`HTTP ${method} ${host}${path}`, async (span: Span) => {
            const tenantId = this.tenantContext.getTenantId();

            // Set span attributes for outbound call including tenant context
            span.setAttributes({
                'http.method': method,
                'http.url': url,
                'http.host': host,
                'http.target': path,
                'http.scheme': parsedUrl.protocol.replace(':', ''),
                'span.kind': 'client',
                'tenant.id': tenantId || 'unknown',
                ...metadata,
            });

            try {
                this.incrementOutboundActiveRequests(host);
                const response = await caller(span);
                const durationMs = Date.now() - startTime;

                // Record success metrics
                span.setAttribute('http.status_code', response.statusCode);
                this.recordOutboundRequest(method, host, path, response.statusCode, durationMs);

                span.setStatus({ code: SpanStatusCode.OK });
                return response.data;
            } catch (error) {
                const durationMs = Date.now() - startTime;
                const errorType = error instanceof Error ? error.constructor.name : 'Unknown';

                // Check if it's a timeout
                if (errorType.toLowerCase().includes('timeout') || (error as { code?: string })?.code === 'ETIMEDOUT') {
                    this.recordOutboundTimeout(method, host, path, durationMs);
                }

                // Record error metrics
                this.recordOutboundError(method, host, path, errorType);

                // Record exceptions in span
                span.recordException(error as Error);
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : 'Unknown error',
                });

                throw error;
            } finally {
                this.decrementOutboundActiveRequests(host);
            }
        });
    }

    /**
     * Start a new span for outbound HTTP request (manual span management)
     * Use this when you need more control over the span lifecycle
     */
    startOutboundSpan(method: string, url: string): Span {
        const parsedUrl = new URL(url);
        const tracer = this.tracingService.getTracer();
        return tracer.startSpan(`HTTP ${method} ${parsedUrl.hostname}${parsedUrl.pathname}`, {
            kind: SpanKind.CLIENT,
            attributes: {
                'http.method': method,
                'http.url': url,
                'http.host': parsedUrl.hostname,
                'http.target': parsedUrl.pathname,
                'http.scheme': parsedUrl.protocol.replace(':', ''),
            },
        });
    }

    /**
     * End a span with success
     */
    endSpanSuccess(span: Span, statusCode: number, durationMs?: number): void {
        span.setAttribute('http.status_code', statusCode);
        if (durationMs !== undefined) {
            span.setAttribute('http.duration_ms', durationMs);
        }
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
    }

    /**
     * End a span with error
     */
    endSpanError(span: Span, error: Error, statusCode?: number, durationMs?: number): void {
        if (statusCode !== undefined) {
            span.setAttribute('http.status_code', statusCode);
        }
        if (durationMs !== undefined) {
            span.setAttribute('http.duration_ms', durationMs);
        }
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        span.end();
    }

    /**
     * Inject tracing headers into outbound HTTP requests
     * IMPORTANT: This does NOT forward JWT/Authorization tokens (security risk)
     * Only propagates distributed tracing context and tenant information
     */
    injectTracingHeaders(headers: Record<string, string> = {}): Record<string, string> {
        const tenantId = this.tenantContext.getTenantId();
        const userId = this.tenantContext.getUserId();
        const correlationId = this.tenantContext.getCorrelationId();

        // Propagate tenant context (for multi-tenant services)
        if (tenantId) {
            headers['X-Tenant-ID'] = tenantId;
        }

        // Propagate user context (for audit trails, NOT authentication)
        if (userId) {
            headers['X-User-ID'] = userId;
        }

        // Propagate correlation ID
        if (correlationId) {
            headers['X-Correlation-ID'] = correlationId;
        }

        // Inject distributed tracing context
        const traceInfo = this.tracingService.getCurrentTraceInfo();
        if (traceInfo) {
            // W3C Trace Context (standard)
            headers['traceparent'] = `00-${traceInfo.traceId}-${traceInfo.spanId}-01`;

            // B3 headers (for compatibility with older systems)
            headers['X-B3-TraceId'] = traceInfo.traceId;
            headers['X-B3-SpanId'] = traceInfo.spanId;
            headers['X-B3-Sampled'] = '1';
        }

        // SECURITY: Remove any Authorization/Cookie headers that might have been passed
        // Service-to-service auth should use machine credentials (API keys, OAuth client credentials)
        delete headers['Authorization'];
        delete headers['authorization'];
        delete headers['Cookie'];
        delete headers['cookie'];

        return headers;
    }

    /**
     * Get headers safe for outbound calls (filtered from incoming request)
     * Removes sensitive headers like Authorization, Cookie, etc.
     */
    getSafeOutboundHeaders(incomingHeaders: Record<string, string | string[]>): Record<string, string> {
        const safeHeaders: Record<string, string> = {};

        // List of headers safe to forward
        const allowedHeaders = [
            'accept',
            'accept-encoding',
            'accept-language',
            'content-type',
            'user-agent',
            'x-request-id',
            'x-forwarded-for',
            'x-forwarded-proto',
            'x-forwarded-host',
        ];

        for (const [key, value] of Object.entries(incomingHeaders)) {
            const lowerKey = key.toLowerCase();

            // Only forward allowed headers
            if (allowedHeaders.includes(lowerKey) && value !== undefined) {
                safeHeaders[key] = Array.isArray(value) ? (value[0] ?? '') : value;
            }
        }

        // Add tracing headers
        return this.injectTracingHeaders(safeHeaders);
    }
}
