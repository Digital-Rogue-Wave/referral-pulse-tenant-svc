import { Injectable } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { TracingService } from './tracing.module';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { Span, SpanKind, SpanStatusCode } from '@opentelemetry/api';

/**
 * Service for recording Messaging (SQS/SNS) metrics and tracing (inbound and outbound)
 * Provides a clean API for tracking message consumption and publishing with full observability
 * Supports multi-tenancy with automatic tenant context propagation
 *
 * NOTE: JWT tokens are NOT included in messages for performance reasons
 */
@Injectable()
export class MessagingMetricsService {
    constructor(
        private readonly metricsService: MetricsService,
        private readonly tracingService: TracingService,
        private readonly tenantContext: ClsTenantContextService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(MessagingMetricsService.name);
    }

    // ==================== Inbound Messaging Metrics (SQS Consumer) ====================

    /**
     * Record an inbound message received from SQS
     */
    recordInboundMessage(queueName: string, eventType: string, success: boolean, durationMs: number, tenantId?: string): void {
        const meter = this.metricsService.getMeter();
        const tenant = tenantId || this.tenantContext.getTenantId() || 'unknown';

        // Counter for total inbound messages
        const counter = meter.createCounter('messaging.inbound.messages.total', {
            description: 'Total number of inbound messages received from SQS',
        });

        counter.add(1, {
            queue_name: queueName,
            event_type: eventType,
            success: success.toString(),
            tenant_id: tenant,
        });

        // Histogram for inbound message processing duration
        const histogram = this.metricsService.createHistogram('messaging.inbound.duration', {
            description: 'Inbound message processing duration in milliseconds',
            unit: 'ms',
        });

        histogram.record(durationMs, {
            queue_name: queueName,
            event_type: eventType,
            success: success.toString(),
            tenant_id: tenant,
        });
    }

    /**
     * Record an inbound message processing error
     */
    recordInboundError(queueName: string, eventType: string, errorType: string, tenantId?: string): void {
        const tenant = tenantId || this.tenantContext.getTenantId() || 'unknown';

        const counter = this.metricsService.createCounter('messaging.inbound.errors.total', {
            description: 'Total number of inbound message processing errors',
        });

        counter.add(1, {
            queue_name: queueName,
            event_type: eventType,
            error_type: errorType,
            tenant_id: tenant,
        });
    }

    /**
     * Record inbound message size
     */
    recordInboundMessageSize(queueName: string, eventType: string, sizeBytes: number): void {
        const histogram = this.metricsService.createHistogram('messaging.inbound.message.size', {
            description: 'Size of inbound messages in bytes',
            unit: 'bytes',
        });

        histogram.record(sizeBytes, {
            queue_name: queueName,
            event_type: eventType,
        });
    }

    // ==================== Outbound Messaging Metrics (SNS Publisher) ====================

    /**
     * Record an outbound message published to SNS
     */
    recordOutboundMessage(
        topicName: string,
        eventType: string,
        success: boolean,
        durationMs: number,
        tenantId?: string,
    ): void {
        const meter = this.metricsService.getMeter();
        const tenant = tenantId || this.tenantContext.getTenantId() || 'unknown';

        // Counter for total outbound messages
        const counter = meter.createCounter('messaging.outbound.messages.total', {
            description: 'Total number of outbound messages published to SNS',
        });

        counter.add(1, {
            topic_name: topicName,
            event_type: eventType,
            success: success.toString(),
            tenant_id: tenant,
        });

        // Histogram for outbound message publishing duration
        const histogram = this.metricsService.createHistogram('messaging.outbound.duration', {
            description: 'Outbound message publishing duration in milliseconds',
            unit: 'ms',
        });

        histogram.record(durationMs, {
            topic_name: topicName,
            event_type: eventType,
            success: success.toString(),
            tenant_id: tenant,
        });
    }

    /**
     * Record an outbound message publishing error
     */
    recordOutboundError(topicName: string, eventType: string, errorType: string, tenantId?: string): void {
        const tenant = tenantId || this.tenantContext.getTenantId() || 'unknown';

        const counter = this.metricsService.createCounter('messaging.outbound.errors.total', {
            description: 'Total number of outbound message publishing errors',
        });

        counter.add(1, {
            topic_name: topicName,
            event_type: eventType,
            error_type: errorType,
            tenant_id: tenant,
        });
    }

    /**
     * Record outbound message size
     */
    recordOutboundMessageSize(topicName: string, eventType: string, sizeBytes: number): void {
        const histogram = this.metricsService.createHistogram('messaging.outbound.message.size', {
            description: 'Size of outbound messages in bytes',
            unit: 'bytes',
        });

        histogram.record(sizeBytes, {
            topic_name: topicName,
            event_type: eventType,
        });
    }

    /**
     * Record outbound retry attempt
     */
    recordOutboundRetry(topicName: string, eventType: string, attemptNumber: number, tenantId?: string): void {
        const tenant = tenantId || this.tenantContext.getTenantId() || 'unknown';

        const counter = this.metricsService.createCounter('messaging.outbound.retries.total', {
            description: 'Total number of outbound message retry attempts',
        });

        counter.add(1, {
            topic_name: topicName,
            event_type: eventType,
            attempt: attemptNumber.toString(),
            tenant_id: tenant,
        });
    }

    // ==================== Queue Metrics ====================

    /**
     * Record DLQ (Dead Letter Queue) message
     */
    recordDlqMessage(queueName: string, eventType: string, tenantId?: string): void {
        const tenant = tenantId || this.tenantContext.getTenantId() || 'unknown';

        const counter = this.metricsService.createCounter('messaging.dlq.messages.total', {
            description: 'Total number of messages sent to DLQ',
        });

        counter.add(1, {
            queue_name: queueName,
            event_type: eventType,
            tenant_id: tenant,
        });
    }

    /**
     * Record message receive count (for monitoring retries)
     */
    recordMessageReceiveCount(queueName: string, eventType: string, receiveCount: number, tenantId?: string): void {
        const tenant = tenantId || this.tenantContext.getTenantId() || 'unknown';

        const histogram = this.metricsService.createHistogram('messaging.message.receive_count', {
            description: 'Number of times a message has been received (retry indicator)',
            unit: 'count',
        });

        histogram.record(receiveCount, {
            queue_name: queueName,
            event_type: eventType,
            tenant_id: tenant,
        });
    }

    // ==================== Inbound Messaging Tracing (SQS Consumer) ====================

    /**
     * Trace an inbound message consumption with automatic span management
     * Use this to wrap inbound message handlers
     */
    async traceInboundMessage<T>(
        queueName: string,
        eventType: string,
        handler: (span: Span) => Promise<T>,
        metadata?: Record<string, string | number>,
    ): Promise<T> {
        const startTime = Date.now();

        return this.tracingService.withSpan(
            `messaging.consume ${queueName} ${eventType}`,
            async (span) => {
                const tenantId = this.tenantContext.getTenantId();

                // Set span attributes including tenant context
                span.setAttributes({
                    'messaging.system': 'aws_sqs',
                    'messaging.operation': 'consume',
                    'messaging.destination': queueName,
                    'messaging.message.type': eventType,
                    'span.kind': 'consumer',
                    'tenant.id': tenantId || 'unknown',
                    ...metadata,
                });

                try {
                    const result = await handler(span);
                    const durationMs = Date.now() - startTime;

                    // Record success metrics with tenant context
                    this.recordInboundMessage(queueName, eventType, true, durationMs, tenantId);

                    span.setStatus({ code: SpanStatusCode.OK });
                    return result;
                } catch (error) {
                    const durationMs = Date.now() - startTime;
                    const errorType = error instanceof Error ? error.constructor.name : 'Unknown';

                    // Record error metrics with tenant context
                    this.recordInboundMessage(queueName, eventType, false, durationMs, tenantId);
                    this.recordInboundError(queueName, eventType, errorType, tenantId);

                    // Record exception in span
                    span.recordException(error as Error);
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: error instanceof Error ? error.message : 'Unknown error',
                    });

                    throw error;
                }
            },
        );
    }

    // ==================== Outbound Messaging Tracing (SNS Publisher) ====================

    /**
     * Trace an outbound message publication with automatic span management
     * Use this to wrap outbound message publishing
     */
    async traceOutboundMessage<T>(
        topicName: string,
        eventType: string,
        publisher: (span: Span) => Promise<T>,
        metadata?: Record<string, string | number>,
    ): Promise<T> {
        const startTime = Date.now();

        return this.tracingService.withSpan(
            `messaging.publish ${topicName} ${eventType}`,
            async (span) => {
                const tenantId = this.tenantContext.getTenantId();

                // Set span attributes for outbound message including tenant context
                span.setAttributes({
                    'messaging.system': 'aws_sns',
                    'messaging.operation': 'publish',
                    'messaging.destination': topicName,
                    'messaging.message.type': eventType,
                    'span.kind': 'producer',
                    'tenant.id': tenantId || 'unknown',
                    ...metadata,
                });

                try {
                    const result = await publisher(span);
                    const durationMs = Date.now() - startTime;

                    // Record success metrics with tenant context
                    this.recordOutboundMessage(topicName, eventType, true, durationMs, tenantId);

                    span.setStatus({ code: SpanStatusCode.OK });
                    return result;
                } catch (error) {
                    const durationMs = Date.now() - startTime;
                    const errorType = error instanceof Error ? error.constructor.name : 'Unknown';

                    // Record error metrics with tenant context
                    this.recordOutboundMessage(topicName, eventType, false, durationMs, tenantId);
                    this.recordOutboundError(topicName, eventType, errorType, tenantId);

                    // Record exception in span
                    span.recordException(error as Error);
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: error instanceof Error ? error.message : 'Unknown error',
                    });

                    throw error;
                }
            },
        );
    }

    /**
     * Start a new span for outbound message publishing (manual span management)
     * Use this when you need more control over the span lifecycle
     */
    startOutboundSpan(topicName: string, eventType: string): Span {
        const tracer = this.tracingService.getTracer();
        const span = tracer.startSpan(`messaging.publish ${topicName} ${eventType}`, {
            kind: SpanKind.PRODUCER,
            attributes: {
                'messaging.system': 'aws_sns',
                'messaging.operation': 'publish',
                'messaging.destination': topicName,
                'messaging.message.type': eventType,
            },
        });

        return span;
    }

    /**
     * End a span with success
     */
    endSpanSuccess(span: Span, durationMs?: number): void {
        if (durationMs !== undefined) {
            span.setAttribute('messaging.duration_ms', durationMs);
        }
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
    }

    /**
     * End a span with error
     */
    endSpanError(span: Span, error: Error, durationMs?: number): void {
        if (durationMs !== undefined) {
            span.setAttribute('messaging.duration_ms', durationMs);
        }
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        span.end();
    }
}