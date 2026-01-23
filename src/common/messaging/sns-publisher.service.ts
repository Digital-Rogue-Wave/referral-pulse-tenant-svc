import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SNSClient, PublishCommand, PublishBatchCommand } from '@aws-sdk/client-sns';
import { LRUCache } from 'lru-cache';
import type { AllConfigType } from '@app/config/config.type';
import type { IPublishOptions } from '@app/types';
import { MessageEnvelopeService } from './message-envelope.service';
import { TracingService } from '@app/common/monitoring/tracing.module';
import { MetricsService } from '@app/common/monitoring/metrics.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { JsonService } from '@app/common/helper/json.service';
import { EnvironmentService } from '@app/common/helper/environment.service';

/**
 * SNS Publisher Service for broadcasting messages to multiple subscribers.
 * Handles tenant-aware and system-wide notifications.
 */
@Injectable()
export class SnsPublisherService implements OnModuleInit {
    private client: SNSClient;
    private readonly topicMap: LRUCache<string, string>;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly environmentService: EnvironmentService,
        private readonly envelopeService: MessageEnvelopeService,
        private readonly tracingService: TracingService,
        private readonly metricsService: MetricsService,
        private readonly logger: AppLoggerService,
        private readonly jsonService: JsonService,
    ) {
        this.logger.setContext(SnsPublisherService.name);
        const topics = this.configService.getOrThrow('aws.sns.topics', { infer: true });

        this.topicMap = new LRUCache<string, string>({
            max: 100,
            ttl: 1000 * 60 * 60 * 24, // 24 hours
        });

        topics.forEach((t) => this.topicMap.set(t.name, t.arn));
    }

    async onModuleInit(): Promise<void> {
        // Use centralized AWS config from EnvironmentService
        const awsConfig = this.environmentService.getAwsClientConfig();
        this.client = new SNSClient(awsConfig);
    }

    /**
     * Publish tenant-aware message to SNS topic.
     * Requires active tenant context.
     */
    async publish<T>(topicName: string, eventType: string, payload: T, options?: IPublishOptions): Promise<string> {
        return this.tracingService.withSpan('sns.publish', async () => {
            const topicArn = this.topicMap.get(topicName);
            if (!topicArn) {
                this.logger.error(`Topic not configured: ${topicName}`);
                this.metricsService.recordSnsMessagePublished(topicName, eventType, false);
                throw new Error(`Topic not configured: ${topicName}`);
            }

            const envelope = this.envelopeService.createEnvelope(eventType, payload, options?.idempotencyKey);

            // Use explicit messageDeduplicationId if provided, otherwise use idempotencyKey, finally messageId
            const deduplicationId = options?.messageDeduplicationId || envelope.idempotencyKey || envelope.messageId;

            this.logger.debug(`Publishing message to topic ${topicName}`, {
                eventType,
                messageId: envelope.messageId,
                tenantId: envelope.tenantId,
                idempotencyKey: envelope.idempotencyKey,
                deduplicationId,
            });

            let success = true;
            try {
                const result = await this.client.send(
                    new PublishCommand({
                        TopicArn: topicArn,
                        Message: this.jsonService.stringify(envelope),
                        MessageGroupId: options?.messageGroupId,
                        MessageDeduplicationId: deduplicationId,
                        MessageAttributes: {
                            eventType: { DataType: 'String', StringValue: eventType },
                            tenantId: { DataType: 'String', StringValue: envelope.tenantId },
                        },
                    }),
                );

                this.logger.log(`Message published to topic ${topicName}: ${result.MessageId}`);
                return result.MessageId!;
            } catch (error) {
                success = false;
                throw error;
            } finally {
                this.metricsService.recordSnsMessagePublished(topicName, eventType, success);
            }
        });
    }

    /**
     * Publish system message (no tenant context required).
     * Use for cross-tenant notifications or system events.
     *
     * @example
     * ```typescript
     * // Notify all tenants about system maintenance
     * await sns.publishSystem('system-notifications', 'system.maintenance.scheduled', {
     *   startTime: '2024-01-01T00:00:00Z',
     *   duration: 3600,
     * });
     * ```
     */
    async publishSystem<T>(topicName: string, eventType: string, payload: T, tenantId?: string): Promise<string> {
        return this.tracingService.withSpan('sns.publishSystem', async () => {
            const topicArn = this.topicMap.get(topicName);
            if (!topicArn) {
                this.logger.error(`Topic not configured: ${topicName}`);
                this.metricsService.recordSnsMessagePublished(topicName, eventType, false);
                throw new Error(`Topic not configured: ${topicName}`);
            }

            const envelope = this.envelopeService.createSystemEnvelope(eventType, payload, tenantId);

            this.logger.debug(`Publishing system message to topic ${topicName}`, {
                eventType,
                messageId: envelope.messageId,
                tenantId: envelope.tenantId,
            });

            let success = true;
            try {
                const result = await this.client.send(
                    new PublishCommand({
                        TopicArn: topicArn,
                        Message: this.jsonService.stringify(envelope),
                        MessageAttributes: {
                            eventType: { DataType: 'String', StringValue: eventType },
                            tenantId: { DataType: 'String', StringValue: envelope.tenantId },
                            isSystem: { DataType: 'String', StringValue: 'true' },
                        },
                    }),
                );

                this.logger.log(`System message published to topic ${topicName}: ${result.MessageId}`);
                return result.MessageId!;
            } catch (error) {
                success = false;
                throw error;
            } finally {
                this.metricsService.recordSnsMessagePublished(topicName, eventType, success);
            }
        });
    }

    async publishBatch<T>(topicName: string, messages: Array<{ eventType: string; payload: T; options?: IPublishOptions }>): Promise<{ successful: string[]; failed: string[] }> {
        return this.tracingService.withSpan('sns.publishBatch', async () => {
            const topicArn = this.topicMap.get(topicName);
            if (!topicArn) throw new Error(`Topic not configured: ${topicName}`);
            if (messages.length > 10) throw new Error('SNS batch size cannot exceed 10');

            const entries = messages.map((msg, i) => {
                const envelope = this.envelopeService.createEnvelope(msg.eventType, msg.payload);
                return { Id: `${i}`, Message: this.jsonService.stringify(envelope), MessageGroupId: msg.options?.messageGroupId };
            });

            const result = await this.client.send(new PublishBatchCommand({ TopicArn: topicArn, PublishBatchRequestEntries: entries }));

            return {
                successful: (result.Successful || []).map((s) => s.MessageId!),
                failed: (result.Failed || []).map((f) => f.Id!),
            };
        });
    }

    getTopicNames(): string[] {
        return Array.from(this.topicMap.keys());
    }
}
