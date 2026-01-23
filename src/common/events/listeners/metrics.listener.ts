import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { MetricsService } from '@app/common/monitoring/metrics.service';
import { BaseDomainEvent } from '@app/common/events/base-domain.event';
import { Counter, Histogram } from '@opentelemetry/api';

/**
 * In-process metrics recording (Prometheus/OpenTelemetry)
 * Fire-and-forget, no external service calls
 *
 * This listener captures ALL domain events and records comprehensive metrics:
 * - Domain event counters (total events by type/tenant)
 * - Messaging metrics (SQS/SNS event tracking)
 * - HTTP metrics (cross-service call tracking)
 * - Event processing duration
 *
 * Metrics are exported to Grafana Cloud for monitoring and alerting.
 */
@Injectable()
export class MetricsListener {
    private domainEventsCounter: Counter;
    private eventProcessingDuration: Histogram;
    private eventSizeHistogram: Histogram;

    constructor(
        private readonly logger: AppLoggerService,
        private readonly metricsService: MetricsService,
    ) {
        this.logger.setContext(MetricsListener.name);

        // Initialize domain events counter
        this.domainEventsCounter = this.metricsService.createCounter('domain.events.total', {
            description: 'Total number of domain events emitted',
        });

        // Initialize event processing duration histogram
        this.eventProcessingDuration = this.metricsService.createHistogram(
            'domain.events.processing.duration',
            {
                description: 'Domain event processing duration in milliseconds',
                unit: 'ms',
            },
        );

        // Initialize event size histogram
        this.eventSizeHistogram = this.metricsService.createHistogram('domain.events.size', {
            description: 'Domain event payload size in bytes',
            unit: 'bytes',
        });
    }

    /**
     * Wildcard listener for ALL domain events → comprehensive metrics recording
     * Records metrics for every event across all domains
     *
     * Pattern: '**' matches all events (e.g., 'toto.created', 'user.updated', etc.)
     */
    @OnEvent('**', { async: true })
    async trackAllEvents(event: BaseDomainEvent): Promise<void> {
        const startTime = Date.now();

        try {
            // Record domain event counter
            this.domainEventsCounter.add(1, {
                event_type: event.eventType,
                tenant_id: event.tenantId,
                has_user_id: event.userId ? 'true' : 'false',
            });

            // Estimate event size for monitoring payload sizes
            const eventSize = JSON.stringify(event).length;
            this.eventSizeHistogram.record(eventSize, {
                event_type: event.eventType,
            });

            // Track messaging-related events (for SQS/SNS metrics correlation)
            this.trackMessagingMetrics(event);

            // Track HTTP-related events (for cross-service call metrics correlation)
            this.trackHttpMetrics(event);

            // Record processing duration
            const duration = Date.now() - startTime;
            this.eventProcessingDuration.record(duration, {
                event_type: event.eventType,
            });

            this.logger.debug(`Metrics recorded: ${event.eventType}`, {
                eventId: event.eventId,
                aggregateId: event.aggregateId,
                duration,
                size: eventSize,
            });
        } catch (error) {
            // Log but don't throw - metrics failures shouldn't affect business logic
            this.logger.error(
                `Failed to record metrics: ${event.eventType}`,
                error instanceof Error ? error.stack : undefined,
                { eventId: event.eventId },
            );
        }
    }

    /**
     * Track messaging-related metrics for correlation with SQS/SNS operations
     * Helps correlate domain events with actual message sending
     */
    private trackMessagingMetrics(event: BaseDomainEvent): void {
        try {
            // Track events that will trigger SQS/SNS sends
            // These metrics help correlate domain events with messaging operations

            const eventCategory = event.eventType.split('.')[0]; // e.g., 'toto', 'user', 'campaign'

            // Record counter for events that trigger messaging
            const messagingTriggerCounter = this.metricsService.createCounter(
                'domain.events.messaging.triggers',
                {
                    description: 'Domain events that trigger SQS/SNS sends',
                },
            );

            messagingTriggerCounter.add(1, {
                event_category: eventCategory,
                event_type: event.eventType,
                tenant_id: event.tenantId,
            });
        } catch (error) {
            // Silent fail - don't affect main metrics
        }
    }

    /**
     * Track HTTP-related metrics for correlation with cross-service HTTP calls
     * Helps correlate domain events with synchronous HTTP operations
     */
    private trackHttpMetrics(event: BaseDomainEvent): void {
        try {
            // Track events that may trigger HTTP calls (sync cross-service)
            // These metrics help correlate domain events with HTTP operations

            const eventCategory = event.eventType.split('.')[0];

            // Record counter for events that trigger HTTP calls
            const httpTriggerCounter = this.metricsService.createCounter(
                'domain.events.http.triggers',
                {
                    description: 'Domain events that trigger HTTP calls',
                },
            );

            httpTriggerCounter.add(1, {
                event_category: eventCategory,
                event_type: event.eventType,
                tenant_id: event.tenantId,
            });
        } catch (error) {
            // Silent fail - don't affect main metrics
        }
    }
}