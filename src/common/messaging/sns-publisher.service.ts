import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { LRUCache } from 'lru-cache';

import type { IPublishOptions } from '@app/types';

import { EnvironmentService } from '@common/helper/environment.service';
import { JsonService } from '@common/helper/json.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MessagingMetricsService } from '@common/monitoring/messaging-metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';

import type { AllConfigType } from '@config/config.type';

import { MessageEnvelopeService } from './message-envelope.service';

/**
 * SNS Publisher Service for broadcasting messages to multiple subscribers.
 * Handles tenant-aware and system-wide notifications.
 */
@Injectable()
export class SnsPublisherService implements OnModuleInit {
    private client!: SNSClient;
    private readonly topicMap: LRUCache<string, string>;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly environmentService: EnvironmentService,
        private readonly envelopeService: MessageEnvelopeService,
        private readonly tracingService: TracingService,
        private readonly messagingMetrics: MessagingMetricsService,
        private readonly logger: AppLoggerService,
        private readonly jsonService: JsonService
    ) {
        this.logger.setContext(SnsPublisherService.name);
        const topics = this.configService.getOrThrow('aws.sns.topics', {
            infer: true
        });

        this.topicMap = new LRUCache<string, string>({
            max: 100,
            ttl: 1000 * 60 * 60 * 24 // 24 hours
        });

        topics.forEach((t) => this.topicMap.set(t.name, t.arn));
    }

    onModuleInit(): void {
        // Use centralized AWS config from EnvironmentService
        const awsConfig = this.environmentService.getAwsClientConfig();
        this.client = new SNSClient(awsConfig);
    }

    /**
     * Publish tenant-aware message to SNS topic.
     * Requires active tenant context.
     */
    async publish<T>(topicName: string, eventType: string, payload: T, options?: IPublishOptions): Promise<string> {
        const startTime = Date.now();

        return this.tracingService.withSpan('sns.publish', async () => {
            const topicArn = this.topicMap.get(topicName);
            if (!topicArn) {
                this.logger.error(`Topic not configured: ${topicName}`);
                this.messagingMetrics.recordOutboundMessage(topicName, eventType, false, Date.now() - startTime);
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
                deduplicationId
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
                            tenantId: { DataType: 'String', StringValue: envelope.tenantId }
                        }
                    })
                );

                this.logger.log(`Message published to topic ${topicName}: ${result.MessageId}`);
                return result.MessageId!;
            } catch (error) {
                success = false;
                throw error;
            } finally {
                this.messagingMetrics.recordOutboundMessage(topicName, eventType, success, Date.now() - startTime);
            }
        });
    }
}
