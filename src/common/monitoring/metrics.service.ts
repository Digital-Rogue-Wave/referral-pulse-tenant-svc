import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { metrics, Meter, Counter, Histogram, ObservableGauge, ValueType } from '@opentelemetry/api';
import type { AllConfigType } from '@app/config/config.type';
import { AppLoggerService } from '@app/common/logging/app-logger.service';

/**
 * Metrics Service for collecting application metrics.
 * Exports to Grafana Cloud Mimir/Prometheus via OpenTelemetry.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
    private meter: Meter | undefined;
    private readonly serviceName: string;

    // Common application metrics
    private httpRequestsTotal: Counter | undefined;
    private httpRequestDuration: Histogram | undefined;
    private httpRequestsActive: ObservableGauge | undefined;

    private dbQueriesTotal: Counter | undefined;
    private dbQueryDuration: Histogram | undefined;

    private sqsMessagesProduced: Counter | undefined;
    private sqsMessagesConsumed: Counter | undefined;
    private sqsMessageProcessingDuration: Histogram | undefined;

    private snsMessagesPublished: Counter | undefined;

    private circuitBreakerState: ObservableGauge | undefined;

    private redisOperationsTotal: Counter | undefined;
    private redisOperationDuration: Histogram | undefined;

    private jsonParseTotal: Counter | undefined;
    private jsonParseDuration: Histogram | undefined;
    private jsonParseFallback: Counter | undefined;
    private jsonParseSize: Histogram | undefined;

    private queueJobsProcessed: Counter | undefined;
    private queueJobProcessingDuration: Histogram | undefined;
    private queueJobsActive: ObservableGauge | undefined;

    // Tracking active HTTP requests and queue jobs
    private activeHttpRequests = 0;
    private activeQueueJobs: Map<string, number> = new Map();

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(MetricsService.name);
        this.serviceName = this.configService.getOrThrow('app.name', { infer: true });
    }

    async onModuleInit(): Promise<void> {
        const metricsEnabled = this.configService.get('tracing.metricsEndpoint', { infer: true });

        if (!metricsEnabled) {
            this.logger.log('Metrics disabled - no metrics endpoint configured');
            return;
        }

        this.logger.log('Initializing metrics...');
        const serviceVersion = this.configService.get('tracing.serviceVersion', { infer: true }) || '1.0.0';
        this.meter = metrics.getMeter(this.serviceName, serviceVersion);

        this.initializeHttpMetrics();
        this.initializeDatabaseMetrics();
        this.initializeMessagingMetrics();
        this.initializeCircuitBreakerMetrics();
        this.initializeRedisMetrics();
        this.initializeJsonMetrics();
        this.initializeQueueMetrics();

        this.logger.log('Metrics initialized successfully');
    }

    private initializeHttpMetrics(): void {
        if (!this.meter) return;

        this.httpRequestsTotal = this.meter.createCounter('http.requests.total', {
            description: 'Total number of HTTP requests',
            valueType: ValueType.INT,
        });

        this.httpRequestDuration = this.meter.createHistogram('http.request.duration', {
            description: 'HTTP request duration in milliseconds',
            unit: 'ms',
            valueType: ValueType.DOUBLE,
        });

        this.httpRequestsActive = this.meter.createObservableGauge('http.requests.active', {
            description: 'Number of active HTTP requests',
            valueType: ValueType.INT,
        });

        this.httpRequestsActive.addCallback((result) => {
            result.observe(this.activeHttpRequests, {
                service: this.serviceName,
            });
        });
    }

    private initializeDatabaseMetrics(): void {
        if (!this.meter) return;

        this.dbQueriesTotal = this.meter.createCounter('db.queries.total', {
            description: 'Total number of database queries',
            valueType: ValueType.INT,
        });

        this.dbQueryDuration = this.meter.createHistogram('db.query.duration', {
            description: 'Database query duration in milliseconds',
            unit: 'ms',
            valueType: ValueType.DOUBLE,
        });
    }

    private initializeMessagingMetrics(): void {
        if (!this.meter) return;

        this.sqsMessagesProduced = this.meter.createCounter('sqs.messages.produced', {
            description: 'Total number of messages sent to SQS',
            valueType: ValueType.INT,
        });

        this.sqsMessagesConsumed = this.meter.createCounter('sqs.messages.consumed', {
            description: 'Total number of messages consumed from SQS',
            valueType: ValueType.INT,
        });

        this.sqsMessageProcessingDuration = this.meter.createHistogram('sqs.message.processing.duration', {
            description: 'SQS message processing duration in milliseconds',
            unit: 'ms',
            valueType: ValueType.DOUBLE,
        });

        this.snsMessagesPublished = this.meter.createCounter('sns.messages.published', {
            description: 'Total number of messages published to SNS',
            valueType: ValueType.INT,
        });
    }

    private initializeCircuitBreakerMetrics(): void {
        if (!this.meter) return;

        this.circuitBreakerState = this.meter.createObservableGauge('circuit_breaker.state', {
            description: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
            valueType: ValueType.INT,
        });
    }

    private initializeRedisMetrics(): void {
        if (!this.meter) return;

        this.redisOperationsTotal = this.meter.createCounter('redis.operations.total', {
            description: 'Total number of Redis operations',
            valueType: ValueType.INT,
        });

        this.redisOperationDuration = this.meter.createHistogram('redis.operation.duration', {
            description: 'Redis operation duration in milliseconds',
            unit: 'ms',
            valueType: ValueType.DOUBLE,
        });
    }

    private initializeJsonMetrics(): void {
        if (!this.meter) return;

        this.jsonParseTotal = this.meter.createCounter('json.parse.total', {
            description: 'Total number of JSON parse operations',
            valueType: ValueType.INT,
        });

        this.jsonParseDuration = this.meter.createHistogram('json.parse.duration', {
            description: 'JSON parse duration in milliseconds',
            unit: 'ms',
            valueType: ValueType.DOUBLE,
        });

        this.jsonParseFallback = this.meter.createCounter('json.parse.fallback', {
            description: 'Number of times JSON parsing fell back to native parser',
            valueType: ValueType.INT,
        });

        this.jsonParseSize = this.meter.createHistogram('json.parse.size', {
            description: 'Size of JSON strings being parsed',
            unit: 'bytes',
            valueType: ValueType.INT,
        });
    }

    // ==================== HTTP Metrics ====================

    recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
        if (!this.httpRequestsTotal || !this.httpRequestDuration) return;

        const labels = {
            method,
            route,
            status_code: statusCode.toString(),
            service: this.serviceName,
        };

        this.httpRequestsTotal.add(1, labels);
        this.httpRequestDuration.record(durationMs, labels);
    }

    incrementActiveHttpRequests(): void {
        this.activeHttpRequests++;
    }

    decrementActiveHttpRequests(): void {
        this.activeHttpRequests--;
    }

    // ==================== Database Metrics ====================

    recordDatabaseQuery(operation: string, table: string, durationMs: number, success: boolean): void {
        if (!this.dbQueriesTotal || !this.dbQueryDuration) return;

        const labels = {
            operation,
            table,
            success: success.toString(),
            service: this.serviceName,
        };

        this.dbQueriesTotal.add(1, labels);
        this.dbQueryDuration.record(durationMs, labels);
    }

    // ==================== Messaging Metrics ====================

    recordSqsMessageProduced(queueName: string, eventType: string, success: boolean): void {
        if (!this.sqsMessagesProduced) return;

        this.sqsMessagesProduced.add(1, {
            queue: queueName,
            event_type: eventType,
            success: success.toString(),
            service: this.serviceName,
        });
    }

    recordSqsMessageConsumed(queueName: string, eventType: string, success: boolean): void {
        if (!this.sqsMessagesConsumed) return;

        this.sqsMessagesConsumed.add(1, {
            queue: queueName,
            event_type: eventType,
            success: success.toString(),
            service: this.serviceName,
        });
    }

    recordSqsMessageProcessingDuration(queueName: string, eventType: string, durationMs: number): void {
        if (!this.sqsMessageProcessingDuration) return;

        this.sqsMessageProcessingDuration.record(durationMs, {
            queue: queueName,
            event_type: eventType,
            service: this.serviceName,
        });
    }

    recordSnsMessagePublished(topicName: string, eventType: string, success: boolean): void {
        if (!this.snsMessagesPublished) return;

        this.snsMessagesPublished.add(1, {
            topic: topicName,
            event_type: eventType,
            success: success.toString(),
            service: this.serviceName,
        });
    }

    // ==================== Circuit Breaker Metrics ====================

    recordCircuitBreakerState(serviceName: string, state: 'CLOSED' | 'HALF_OPEN' | 'OPEN'): void {
        // State is recorded via observable gauge in circuit breaker service
        // This is a placeholder for future implementation
    }

    // ==================== Redis Metrics ====================

    recordRedisOperation(operation: string, durationMs: number, success: boolean): void {
        if (!this.redisOperationsTotal || !this.redisOperationDuration) return;

        const labels = {
            operation,
            success: success.toString(),
            service: this.serviceName,
        };

        this.redisOperationsTotal.add(1, labels);
        this.redisOperationDuration.record(durationMs, labels);
    }

    private initializeQueueMetrics(): void {
        if (!this.meter) return;

        this.queueJobsProcessed = this.meter.createCounter('queue.jobs.processed', {
            description: 'Total number of queue jobs processed',
            valueType: ValueType.INT,
        });

        this.queueJobProcessingDuration = this.meter.createHistogram('queue.job.processing.duration', {
            description: 'Queue job processing duration in milliseconds',
            unit: 'ms',
            valueType: ValueType.DOUBLE,
        });

        this.queueJobsActive = this.meter.createObservableGauge('queue.jobs.active', {
            description: 'Number of active queue jobs by queue name',
            valueType: ValueType.INT,
        });

        this.queueJobsActive.addCallback((result) => {
            for (const [queueName, count] of this.activeQueueJobs.entries()) {
                result.observe(count, {
                    queue: queueName,
                    service: this.serviceName,
                });
            }
        });
    }

    // ==================== JSON Metrics ====================

    recordJsonParse(durationMs: number, sizeBytes: number, usedFallback: boolean): void {
        if (!this.jsonParseTotal || !this.jsonParseDuration || !this.jsonParseSize) return;

        const labels = {
            parser: usedFallback ? 'native' : 'simdjson',
            service: this.serviceName,
        };

        this.jsonParseTotal.add(1, labels);
        this.jsonParseDuration.record(durationMs, labels);
        this.jsonParseSize.record(sizeBytes, labels);

        if (usedFallback && this.jsonParseFallback) {
            this.jsonParseFallback.add(1, { service: this.serviceName });
        }
    }

    // ==================== Queue Metrics ====================

    recordQueueJobProcessed(queueName: string, success: boolean, durationMs: number): void {
        if (!this.queueJobsProcessed || !this.queueJobProcessingDuration) return;

        const labels = {
            queue: queueName,
            success: success.toString(),
            service: this.serviceName,
        };

        this.queueJobsProcessed.add(1, labels);
        this.queueJobProcessingDuration.record(durationMs, labels);
    }

    incrementActiveQueueJobs(queueName: string): void {
        const current = this.activeQueueJobs.get(queueName) || 0;
        this.activeQueueJobs.set(queueName, current + 1);
    }

    decrementActiveQueueJobs(queueName: string): void {
        const current = this.activeQueueJobs.get(queueName) || 0;
        if (current > 0) {
            this.activeQueueJobs.set(queueName, current - 1);
        }
    }

    // ==================== Custom Metrics ====================

    /**
     * Get the meter instance for creating custom metrics.
     *
     * @example
     * ```typescript
     * const meter = this.metricsService.getMeter();
     * const myCounter = meter.createCounter('my.custom.counter', {
     *   description: 'My custom counter',
     * });
     * myCounter.add(1, { label: 'value' });
     * ```
     */
    getMeter(): Meter {
        if (!this.meter) {
            return metrics.getMeter('noop');
        }
        return this.meter;
    }

    /**
     * Create a custom counter metric.
     *
     * @example
     * ```typescript
     * const loginCounter = this.metricsService.createCounter('user.logins.total', {
     *   description: 'Total number of user logins',
     * });
     * loginCounter.add(1, { user_type: 'admin' });
     * ```
     */
    createCounter(name: string, options?: { description?: string; unit?: string }): Counter {
        const meter = this.getMeter();
        return meter.createCounter(name, {
            description: options?.description,
            unit: options?.unit,
            valueType: ValueType.INT,
        });
    }

    /**
     * Create a custom histogram metric.
     *
     * @example
     * ```typescript
     * const processingTime = this.metricsService.createHistogram('order.processing.duration', {
     *   description: 'Order processing duration',
     *   unit: 'ms',
     * });
     * processingTime.record(150, { order_type: 'express' });
     * ```
     */
    createHistogram(name: string, options?: { description?: string; unit?: string }): Histogram {
        const meter = this.getMeter();
        return meter.createHistogram(name, {
            description: options?.description,
            unit: options?.unit,
            valueType: ValueType.DOUBLE,
        });
    }

    /**
     * Create a custom gauge metric.
     *
     * @example
     * ```typescript
     * let activeUsers = 0;
     * const gauge = this.metricsService.createGauge('users.active', {
     *   description: 'Number of active users',
     * });
     * gauge.addCallback((result) => {
     *   result.observe(activeUsers, { service: 'campaign' });
     * });
     * ```
     */
    createGauge(name: string, options?: { description?: string; unit?: string }): ObservableGauge {
        const meter = this.getMeter();
        return meter.createObservableGauge(name, {
            description: options?.description,
            unit: options?.unit,
            valueType: ValueType.INT,
        });
    }
}