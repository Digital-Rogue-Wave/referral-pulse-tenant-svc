import { Injectable, OnModuleInit } from '@nestjs/common';

import { Counter, Histogram } from '@opentelemetry/api';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';

import { AppLoggerService } from '@common/logging/app-logger.service';

import { MetricsService } from './metrics.service';
import { TracingService } from './tracing.service';

/**
 * Service for recording Messaging (SQS/SNS) metrics and tracing (inbound and outbound)
 * Provides a clean API for tracking message consumption and publishing with full observability
 * Supports multi-tenancy with automatic tenant context propagation
 *
 * Note: OpenTelemetry's AwsInstrumentation provides automatic SQS/SNS spans.
 * This service adds business-specific metrics with tenant context and custom labels.
 */
@Injectable()
export class MessagingMetricsService implements OnModuleInit {
    // Pre-initialized inbound (SQS) metrics
    private inboundMessagesCounter!: Counter;
    private inboundDurationHistogram!: Histogram;
    private inboundErrorsCounter!: Counter;
    private inboundMessageSizeHistogram!: Histogram;

    // Pre-initialized outbound (SNS) metrics
    private outboundMessagesCounter!: Counter;
    private outboundDurationHistogram!: Histogram;
    private outboundErrorsCounter!: Counter;
    private outboundMessageSizeHistogram!: Histogram;
    private outboundRetriesCounter!: Counter;

    // DLQ and receive count metrics
    private dlqMessagesCounter!: Counter;
    private messageReceiveCountHistogram!: Histogram;

    constructor(
        private readonly metricsService: MetricsService,
        private readonly tracingService: TracingService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(MessagingMetricsService.name);
    }

    onModuleInit(): void {
        this.initializeInboundMetrics();
        this.initializeOutboundMetrics();
        this.initializeQueueMetrics();
        this.logger.log('Messaging Metrics Service initialized');
    }

    private initializeInboundMetrics(): void {
        const meter = this.metricsService.getMeter();

        this.inboundMessagesCounter = meter.createCounter('messaging.inbound.messages.total', {
            description: 'Total number of inbound messages received from SQS'
        });

        this.inboundDurationHistogram = this.metricsService.createHistogram('messaging.inbound.duration', {
            description: 'Inbound message processing duration in milliseconds',
            unit: 'ms'
        });

        this.inboundErrorsCounter = meter.createCounter('messaging.inbound.errors.total', {
            description: 'Total number of inbound message processing errors'
        });

        this.inboundMessageSizeHistogram = this.metricsService.createHistogram('messaging.inbound.message.size', {
            description: 'Size of inbound messages in bytes',
            unit: 'bytes'
        });
    }

    private initializeOutboundMetrics(): void {
        const meter = this.metricsService.getMeter();

        this.outboundMessagesCounter = meter.createCounter('messaging.outbound.messages.total', {
            description: 'Total number of outbound messages published to SNS'
        });

        this.outboundDurationHistogram = this.metricsService.createHistogram('messaging.outbound.duration', {
            description: 'Outbound message publishing duration in milliseconds',
            unit: 'ms'
        });

        this.outboundErrorsCounter = meter.createCounter('messaging.outbound.errors.total', {
            description: 'Total number of outbound message publishing errors'
        });

        this.outboundMessageSizeHistogram = this.metricsService.createHistogram('messaging.outbound.message.size', {
            description: 'Size of outbound messages in bytes',
            unit: 'bytes'
        });

        this.outboundRetriesCounter = meter.createCounter('messaging.outbound.retries.total', {
            description: 'Total number of outbound message retry attempts'
        });
    }

    private initializeQueueMetrics(): void {
        const meter = this.metricsService.getMeter();

        this.dlqMessagesCounter = meter.createCounter('messaging.dlq.messages.total', {
            description: 'Total number of messages sent to DLQ'
        });

        this.messageReceiveCountHistogram = this.metricsService.createHistogram('messaging.message.receive_count', {
            description: 'Number of times a message has been received (retry indicator)',
            unit: 'count'
        });
    }

    // ==================== Inbound Messaging Metrics (SQS Consumer) ====================

    /**
     * Record an inbound message processing error
     */
    recordInboundError(queueName: string, eventType: string, errorType: string, tenantId?: string): void {
        const tenant = tenantId || this.tenantContext.getTenantId() || 'unknown';

        this.inboundErrorsCounter.add(1, {
            queue_name: queueName,
            event_type: eventType,
            error_type: errorType,
            tenant_id: tenant
        });
    }

    // ==================== Outbound Messaging Metrics (SNS Publisher) ====================

    /**
     * Record an outbound message published to SNS (uses pre-initialized metrics)
     */
    recordOutboundMessage(topicName: string, eventType: string, success: boolean, durationMs: number, tenantId?: string): void {
        const tenant = tenantId || this.tenantContext.getTenantId() || 'unknown';

        this.outboundMessagesCounter.add(1, {
            topic_name: topicName,
            event_type: eventType,
            success: success.toString(),
            tenant_id: tenant
        });

        this.outboundDurationHistogram.record(durationMs, {
            topic_name: topicName,
            event_type: eventType,
            success: success.toString(),
            tenant_id: tenant
        });
    }

    /**
     * Record an outbound message publishing error
     */
    recordOutboundError(topicName: string, eventType: string, errorType: string, tenantId?: string): void {
        const tenant = tenantId || this.tenantContext.getTenantId() || 'unknown';

        this.outboundErrorsCounter.add(1, {
            topic_name: topicName,
            event_type: eventType,
            error_type: errorType,
            tenant_id: tenant
        });
    }

    // ==================== Queue Metrics ====================

    // ==================== Inbound Messaging Tracing (SQS Consumer) ====================

    // ==================== Outbound Messaging Tracing (SNS Publisher) ====================
}
