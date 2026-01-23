import { Injectable } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { TracingService } from './tracing.module';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { Span, SpanKind, SpanStatusCode } from '@opentelemetry/api';

/**
 * Service for recording HTTP metrics and tracing (inbound and outbound)
 * Provides a clean API for tracking HTTP communication with full observability
 * Supports multi-tenancy with automatic tenant context propagation
 */
@Injectable()
export class HttpMetricsService {
    constructor(
        private readonly metricsService: MetricsService,
        private readonly tracingService: TracingService,
        private readonly tenantContext: ClsTenantContextService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(HttpMetricsService.name);
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

        // Record request/response sizes if provided
        if (requestSizeBytes !== undefined) {
            const requestSizeHistogram = this.metricsService.createHistogram('http.inbound.request.size', {
                description: 'Size of inbound HTTP request body in bytes',
                unit: 'bytes',
            });
            requestSizeHistogram.record(requestSizeBytes, { method, route });
        }

        if (responseSizeBytes !== undefined) {
            const responseSizeHistogram = this.metricsService.createHistogram('http.inbound.response.size', {
                description: 'Size of inbound HTTP response body in bytes',
                unit: 'bytes',
            });
            responseSizeHistogram.record(responseSizeBytes, { method, route });
        }
    }

    /**
     * Record inbound HTTP error
     */
    recordInboundError(method: string, route: string, statusCode: number, errorType: string): void {
        const counter = this.metricsService.createCounter('http.inbound.errors.total', {
            description: 'Total number of inbound HTTP errors',
        });

        counter.add(1, {
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
     * Record an outbound HTTP request
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
        const meter = this.metricsService.getMeter();

        // Counter for total outbound HTTP requests
        const counter = meter.createCounter('http.outbound.requests.total', {
            description: 'Total number of outbound HTTP requests',
        });

        counter.add(1, {
            method,
            host,
            path,
            status_code: statusCode.toString(),
            success: (statusCode >= 200 && statusCode < 300).toString(),
        });

        // Histogram for outbound HTTP duration
        const histogram = this.metricsService.createHistogram('http.outbound.duration', {
            description: 'Outbound HTTP request duration in milliseconds',
            unit: 'ms',
        });

        histogram.record(durationMs, {
            method,
            host,
            status_code: statusCode.toString(),
        });

        // Record request/response sizes if provided
        if (requestSizeBytes !== undefined) {
            const requestSizeHistogram = this.metricsService.createHistogram('http.outbound.request.size', {
                description: 'Size of outbound HTTP request body in bytes',
                unit: 'bytes',
            });
            requestSizeHistogram.record(requestSizeBytes, { method, host });
        }

        if (responseSizeBytes !== undefined) {
            const responseSizeHistogram = this.metricsService.createHistogram('http.outbound.response.size', {
                description: 'Size of outbound HTTP response body in bytes',
                unit: 'bytes',
            });
            responseSizeHistogram.record(responseSizeBytes, { method, host });
        }
    }

    /**
     * Record outbound HTTP error
     */
    recordOutboundError(method: string, host: string, path: string, errorType: string): void {
        const counter = this.metricsService.createCounter('http.outbound.errors.total', {
            description: 'Total number of outbound HTTP errors',
        });

        counter.add(1, {
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
        const counter = this.metricsService.createCounter('http.outbound.timeouts.total', {
            description: 'Total number of outbound HTTP timeouts',
        });

        counter.add(1, {
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
        const counter = this.metricsService.createCounter('http.outbound.retries.total', {
            description: 'Total number of outbound HTTP retry attempts',
        });

        counter.add(1, {
            method,
            host,
            path,
            attempt: attemptNumber.toString(),
            reason,
        });
    }

    /**
     * Record outbound circuit breaker state
     */
    recordOutboundCircuitBreakerState(host: string, state: 'CLOSED' | 'HALF_OPEN' | 'OPEN'): void {
        this.logger.log(`⚡ Circuit breaker state changed: ${host} - ${state}`);

        const gauge = this.metricsService.createGauge('http.outbound.circuit_breaker.state', {
            description: 'HTTP circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)',
        });

        const stateValue = state === 'CLOSED' ? 0 : state === 'HALF_OPEN' ? 1 : 2;

        gauge.addCallback((result) => {
            result.observe(stateValue, { host });
        });
    }

    /**
     * Record outbound circuit breaker trip
     */
    recordOutboundCircuitBreakerTrip(host: string, reason: string): void {
        this.logger.warn(`⚠️ Circuit breaker tripped: ${host} - ${reason}`);

        const counter = this.metricsService.createCounter('http.outbound.circuit_breaker.trips.total', {
            description: 'Total number of circuit breaker trips',
        });

        counter.add(1, { host, reason });
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
    recordConnectionPoolStats(host: string, active: number, idle: number, waiting: number): void {
        const activeGauge = this.metricsService.createGauge('http.connection_pool.active', {
            description: 'Number of active HTTP connections in pool',
        });
        activeGauge.addCallback((result) => result.observe(active, { host }));

        const idleGauge = this.metricsService.createGauge('http.connection_pool.idle', {
            description: 'Number of idle HTTP connections in pool',
        });
        idleGauge.addCallback((result) => result.observe(idle, { host }));

        const waitingGauge = this.metricsService.createGauge('http.connection_pool.waiting', {
            description: 'Number of requests waiting for HTTP connection',
        });
        waitingGauge.addCallback((result) => result.observe(waiting, { host }));
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

        return this.tracingService.withSpan(
            `HTTP ${method} ${route}`,
            async (span) => {
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
                    const statusCode = (error as any)?.statusCode || 500;
                    const errorType = error instanceof Error ? error.constructor.name : 'Unknown';

                    // Record error metrics
                    span.setAttribute('http.status_code', statusCode);
                    this.recordInboundRequest(method, route, statusCode, durationMs);
                    this.recordInboundError(method, route, statusCode, errorType);

                    // Record exception in span
                    span.recordException(error as Error);
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: error instanceof Error ? error.message : 'Unknown error',
                    });

                    throw error;
                } finally {
                    this.decrementInboundActiveRequests();
                }
            },
        );
    }

    // ==================== Outbound HTTP Tracing ====================

    /**
     * Trace an outbound HTTP request with automatic span management
     * Use this to wrap HTTP client calls
     */
    async traceOutboundRequest<T>(
        method: string,
        url: string,
        caller: (span: Span) => Promise<{ data: T; statusCode: number; headers?: Record<string, string> }>,
        metadata?: Record<string, string | number>,
    ): Promise<T> {
        const startTime = Date.now();
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname;
        const path = parsedUrl.pathname;

        return this.tracingService.withSpan(
            `HTTP ${method} ${host}${path}`,
            async (span) => {
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
                    if (errorType.toLowerCase().includes('timeout') || (error as any)?.code === 'ETIMEDOUT') {
                        this.recordOutboundTimeout(method, host, path, durationMs);
                    }

                    // Record error metrics
                    this.recordOutboundError(method, host, path, errorType);

                    // Record exception in span
                    span.recordException(error as Error);
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: error instanceof Error ? error.message : 'Unknown error',
                    });

                    throw error;
                } finally {
                    this.decrementOutboundActiveRequests(host);
                }
            },
        );
    }

    /**
     * Start a new span for outbound HTTP request (manual span management)
     * Use this when you need more control over the span lifecycle
     */
    startOutboundSpan(method: string, url: string): Span {
        const parsedUrl = new URL(url);
        const tracer = this.tracingService.getTracer();
        const span = tracer.startSpan(`HTTP ${method} ${parsedUrl.hostname}${parsedUrl.pathname}`, {
            kind: SpanKind.CLIENT,
            attributes: {
                'http.method': method,
                'http.url': url,
                'http.host': parsedUrl.hostname,
                'http.target': parsedUrl.pathname,
                'http.scheme': parsedUrl.protocol.replace(':', ''),
            },
        });

        return span;
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
            if (allowedHeaders.includes(lowerKey)) {
                safeHeaders[key] = Array.isArray(value) ? value[0] : value;
            }
        }

        // Add tracing headers
        return this.injectTracingHeaders(safeHeaders);
    }
}