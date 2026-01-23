import { Injectable } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { IdempotencyService } from '@app/common/idempotency';
import { MessageEnvelopeService } from './message-envelope.service';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { MetricsService } from '@app/common/monitoring/metrics.service';
import type { IMessageEnvelope } from '@app/types';

/**
 * Helper service for processing SQS messages with automatic:
 * - Envelope parsing
 * - Tenant context setup
 * - Idempotency checking
 * - Metrics recording
 *
 * Use this in your @SqsMessageHandler methods to reduce boilerplate.
 */
@Injectable()
export class MessageProcessorService {
    constructor(
        private readonly idempotencyService: IdempotencyService,
        private readonly envelopeService: MessageEnvelopeService,
        private readonly tenantContext: ClsTenantContextService,
        private readonly logger: AppLoggerService,
        private readonly metricsService: MetricsService,
    ) {
        this.logger.setContext(MessageProcessorService.name);
    }

    /**
     * Process an SQS message with automatic envelope parsing, tenant context setup,
     * idempotency checking, and metrics recording.
     *
     * @example
     * ```typescript
     * @SqsMessageHandler('my-queue', false)
     * async handleMessage(message: Message) {
     *   await this.messageProcessor.process<MyPayload>(message, async (envelope) => {
     *     // Process envelope.payload
     *     await this.myService.handle(envelope.payload);
     *   });
     * }
     * ```
     */
    async process<T>(
        message: Message,
        handler: (envelope: IMessageEnvelope<T>) => Promise<void>,
        options?: {
            queueName?: string;
            skipIdempotency?: boolean;
        },
    ): Promise<void> {
        if (!message?.Body) {
            this.logger.warn('Received SQS message without body');
            return;
        }

        let envelope: IMessageEnvelope<T>;

        try {
            envelope = this.envelopeService.parseEnvelope<T>(message.Body);
        } catch (error) {
            this.logger.error('Failed to parse message envelope', (error as Error).stack);
            throw error;
        }

        // Set tenant context
        this.tenantContext.set('tenantId', envelope.tenantId);
        this.tenantContext.set('requestId', envelope.messageId);
        this.tenantContext.set('correlationId', envelope.correlationId);

        // Store trace context if available
        if (envelope.metadata?.traceId) {
            this.tenantContext.set('traceId', envelope.metadata.traceId);
        }
        if (envelope.metadata?.spanId) {
            this.tenantContext.set('spanId', envelope.metadata.spanId);
        }
        if (envelope.metadata?.userId) {
            this.tenantContext.set('userId', envelope.metadata.userId);
        }

        // Skip idempotency if requested
        if (options?.skipIdempotency) {
            await handler(envelope);
            this.recordMetrics(envelope, options.queueName, false);
            return;
        }

        // Process with idempotency
        const idempotencyKey = envelope.idempotencyKey || envelope.messageId;
        const { isDuplicate } = await this.idempotencyService.executeOnce(
            idempotencyKey,
            async () => {
                await handler(envelope);
                return true;
            },
        );

        if (isDuplicate) {
            this.logger.log(`Duplicate message skipped: ${envelope.messageId}`);
        }

        this.recordMetrics(envelope, options?.queueName, isDuplicate);
    }

    private recordMetrics(envelope: IMessageEnvelope, queueName?: string, isDuplicate?: boolean): void {
        this.metricsService.recordSqsMessageConsumed(
            queueName || (envelope.metadata?.queueName as string) || 'unknown',
            envelope.eventType,
            !isDuplicate,
        );
    }
}