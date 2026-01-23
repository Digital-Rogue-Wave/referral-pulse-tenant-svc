import { Injectable } from '@nestjs/common';
import { SqsService } from '@ssut/nestjs-sqs';
import { ConfigService } from '@nestjs/config';
import { LRUCache } from 'lru-cache';
import type { AllConfigType } from '@app/config/config.type';
import type { IPublishOptions } from '@app/types';
import { MessageEnvelopeService } from './message-envelope.service';
import { TracingService } from '@app/common/monitoring/tracing.module';
import { MetricsService } from '@app/common/monitoring/metrics.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';

/**
 * SQS Producer Service using @ssut/nestjs-sqs library.
 * Handles sending messages to SQS queues with automatic envelope wrapping,
 * tracing, and multitenancy support.
 */
@Injectable()
export class SqsProducerService {
    private readonly queueMap: LRUCache<string, string>;

    constructor(
        private readonly sqsService: SqsService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly envelopeService: MessageEnvelopeService,
        private readonly tracingService: TracingService,
        private readonly metricsService: MetricsService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(SqsProducerService.name);
        const queues = this.configService.getOrThrow('aws.sqs.queues', { infer: true });

        this.queueMap = new LRUCache<string, string>({
            max: 100,
            ttl: 1000 * 60 * 60 * 24, // 24 hours
        });

        queues.forEach((q) => this.queueMap.set(q.name, q.url));
    }

    async send<T>(queueName: string, eventType: string, payload: T, options?: IPublishOptions): Promise<string> {
        return this.tracingService.withSpan('sqs.send', async () => {
            if (!this.queueMap.has(queueName)) {
                this.logger.error(`Queue not configured: ${queueName}`);
                this.metricsService.recordSqsMessageProduced(queueName, eventType, false);
                throw new Error(`Queue not configured: ${queueName}`);
            }

            this.tracingService.addSpanAttributes({ 'sqs.queue': queueName, 'sqs.eventType': eventType });

            const envelope = this.envelopeService.createEnvelope(eventType, payload, options?.idempotencyKey);

            // Use explicit messageDeduplicationId if provided, otherwise use idempotencyKey, finally messageId
            const deduplicationId = options?.messageDeduplicationId || envelope.idempotencyKey || envelope.messageId;

            this.logger.debug(`Sending message to queue ${queueName}`, {
                eventType,
                messageId: envelope.messageId,
                tenantId: envelope.tenantId,
                idempotencyKey: envelope.idempotencyKey,
                deduplicationId,
            });

            let success = true;
            try {
                await this.sqsService.send(queueName, {
                    id: envelope.messageId,
                    body: envelope,
                    delaySeconds: options?.delaySeconds,
                    groupId: options?.messageGroupId,
                    deduplicationId,
                    messageAttributes: {
                        eventType: { DataType: 'String', StringValue: eventType },
                        tenantId: { DataType: 'String', StringValue: envelope.tenantId },
                        correlationId: { DataType: 'String', StringValue: envelope.correlationId },
                    },
                });

                this.logger.log(`Message sent to queue ${queueName}: ${envelope.messageId}`);
                return envelope.messageId;
            } catch (error) {
                success = false;
                throw error;
            } finally {
                this.metricsService.recordSqsMessageProduced(queueName, eventType, success);
            }
        });
    }

    async sendBatch<T>(queueName: string, messages: Array<{ eventType: string; payload: T; options?: IPublishOptions }>): Promise<{ successful: string[]; failed: string[] }> {
        return this.tracingService.withSpan('sqs.sendBatch', async () => {
            if (!this.queueMap.has(queueName)) throw new Error(`Queue not configured: ${queueName}`);

            const successful: string[] = [];
            const failed: string[] = [];

            for (const msg of messages) {
                try {
                    const id = await this.send(queueName, msg.eventType, msg.payload, msg.options);
                    successful.push(id);
                } catch {
                    failed.push('unknown');
                }
            }

            return { successful, failed };
        });
    }

    getQueueNames(): string[] {
        return Array.from(this.queueMap.keys());
    }

    hasQueue(queueName: string): boolean {
        return this.queueMap.has(queueName);
    }
}
