import { Injectable, OnModuleInit } from '@nestjs/common';

import { Counter, Histogram, ObservableGauge } from '@opentelemetry/api';
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
        ttl: 1000 * 60 * 60 // 1 hour TTL
    });

    // Connection pool stats tracking (LRU cache)
    private readonly connectionPoolStats = new LRUCache<string, { active: number; idle: number; waiting: number }>({
        max: 100,
        ttl: 1000 * 60 * 5 // 5 min TTL
    });

    constructor(
        private readonly metricsService: MetricsService,
        private readonly tracingService: TracingService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService
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
            description: 'Total number of outbound HTTP requests'
        });

        this.outboundDurationHistogram = this.metricsService.createHistogram('http.outbound.duration', {
            description: 'Outbound HTTP request duration in milliseconds',
            unit: 'ms'
        });

        this.outboundErrorsCounter = meter.createCounter('http.outbound.errors.total', {
            description: 'Total number of outbound HTTP errors'
        });

        this.outboundTimeoutsCounter = meter.createCounter('http.outbound.timeouts.total', {
            description: 'Total number of outbound HTTP timeouts'
        });

        this.outboundRetriesCounter = meter.createCounter('http.outbound.retries.total', {
            description: 'Total number of outbound HTTP retry attempts'
        });

        this.outboundCircuitBreakerTripsCounter = meter.createCounter('http.outbound.circuit_breaker.trips.total', {
            description: 'Total number of circuit breaker trips'
        });

        this.outboundRequestSizeHistogram = this.metricsService.createHistogram('http.outbound.request.size', {
            description: 'Size of outbound HTTP request body in bytes',
            unit: 'bytes'
        });

        this.outboundResponseSizeHistogram = this.metricsService.createHistogram('http.outbound.response.size', {
            description: 'Size of outbound HTTP response body in bytes',
            unit: 'bytes'
        });

        // Circuit breaker state observable gauge
        this.circuitBreakerStateGauge = this.metricsService.createGauge('http.outbound.circuit_breaker.state', {
            description: 'HTTP circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)'
        });
        this.circuitBreakerStateGauge.addCallback((result) => {
            for (const [host, stateValue] of this.circuitBreakerStates.entries()) {
                result.observe(stateValue, { host });
            }
        });

        // Connection pool observable gauges
        this.connectionPoolActiveGauge = this.metricsService.createGauge('http.connection_pool.active', {
            description: 'Number of active HTTP connections in pool'
        });
        this.connectionPoolActiveGauge.addCallback((result) => {
            for (const [host, stats] of this.connectionPoolStats.entries()) {
                result.observe(stats.active, { host });
            }
        });

        this.connectionPoolIdleGauge = this.metricsService.createGauge('http.connection_pool.idle', {
            description: 'Number of idle HTTP connections in pool'
        });
        this.connectionPoolIdleGauge.addCallback((result) => {
            for (const [host, stats] of this.connectionPoolStats.entries()) {
                result.observe(stats.idle, { host });
            }
        });

        this.connectionPoolWaitingGauge = this.metricsService.createGauge('http.connection_pool.waiting', {
            description: 'Number of requests waiting for HTTP connection'
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
            unit: 'bytes'
        });

        this.inboundResponseSizeHistogram = this.metricsService.createHistogram('http.inbound.response.size', {
            description: 'Size of inbound HTTP response body in bytes',
            unit: 'bytes'
        });

        this.inboundErrorsCounter = this.metricsService.createCounter('http.inbound.errors.total', {
            description: 'Total number of inbound HTTP errors'
        });
    }

    // ==================== Inbound HTTP Metrics ====================

    /**
     * Record inbound HTTP error
     */
    recordInboundError(method: string, route: string, statusCode: number, errorType: string): void {
        this.inboundErrorsCounter.add(1, {
            method,
            route,
            status_code: statusCode.toString(),
            error_type: errorType
        });
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
        responseSizeBytes?: number
    ): void {
        this.outboundRequestsCounter.add(1, {
            method,
            host,
            path,
            status_code: statusCode.toString(),
            success: (statusCode >= 200 && statusCode < 300).toString()
        });

        this.outboundDurationHistogram.record(durationMs, {
            method,
            host,
            status_code: statusCode.toString()
        });

        // Record request/response sizes if provided
        if (requestSizeBytes !== undefined) {
            this.outboundRequestSizeHistogram.record(requestSizeBytes, {
                method,
                host
            });
        }

        if (responseSizeBytes !== undefined) {
            this.outboundResponseSizeHistogram.record(responseSizeBytes, {
                method,
                host
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
            error_type: errorType
        });
    }

    /**
     * Track active outbound HTTP requests
     */
    private activeOutboundRequests: Map<string, number> = new Map();

    // ==================== Connection Pool Metrics ====================

    /**
     * Record HTTP connection pool stats
     */
    // ==================== Inbound HTTP Tracing ====================

    // ==================== Outbound HTTP Tracing ====================

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
}
