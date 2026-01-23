import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    SQSClient,
    ReceiveMessageCommand,
    DeleteMessageCommand,
    SendMessageCommand,
    GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { LRUCache } from 'lru-cache';
import type { AllConfigType } from '@app/config/config.type';
import type { IDlqMessage, IMessageEnvelope } from '@app/types';
import { TracingService } from '@app/common/monitoring/tracing.module';
import { DateService } from '@app/common/helper/date.service';
import { JsonService } from '@app/common/helper/json.service';
import { EnvironmentService } from '@app/common/helper/environment.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { IdempotencyService } from '@app/common/idempotency';

/**
 * DLQ Consumer Service with Auto-Discovery and Deduplication
 *
 * Features:
 * - Auto-derives DLQ URLs from main queue URLs (FIFO pattern)
 * - Monitors DLQ message counts
 * - Manual replay functionality
 * - Message deduplication to prevent reprocessing duplicates
 * - DLQ purging capabilities
 *
 * DLQ Naming Convention (FIFO):
 * - Main Queue: campaign-events.fifo
 * - DLQ: campaign-events-dlq.fifo (auto-derived)
 */
@Injectable()
export class DlqConsumerService implements OnModuleInit {
    private client: SQSClient;
    private readonly queueMap: LRUCache<string, { queueUrl: string; dlqUrl: string }>;

    constructor(
        private readonly configService: ConfigService<AllConfigType>,
        private readonly environmentService: EnvironmentService,
        private readonly idempotencyService: IdempotencyService,
        private readonly tracingService: TracingService,
        private readonly dateService: DateService,
        private readonly jsonService: JsonService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(DlqConsumerService.name);

        this.queueMap = new LRUCache<string, { queueUrl: string; dlqUrl: string }>({
            max: 100,
            ttl: 1000 * 60 * 60 * 24, // 24 hours
        });

        // Build queue map with auto-derived DLQ URLs
        const queues = this.configService.getOrThrow('aws.sqs.queues', { infer: true });
        for (const queue of queues) {
            // Auto-derive DLQ URL from main queue URL
            // Pattern: queue-name.fifo -> queue-name-dlq.fifo
            const dlqUrl = this.deriveDlqUrl(queue.url);

            this.queueMap.set(queue.name, {
                queueUrl: queue.url,
                dlqUrl,
            });

            this.logger.log(`Queue registered: ${queue.name}`, {
                queueUrl: queue.url,
                dlqUrl,
            });
        }
    }

    async onModuleInit(): Promise<void> {
        // Use centralized AWS config from EnvironmentService
        const awsConfig = this.environmentService.getAwsClientConfig();
        this.client = new SQSClient(awsConfig);

        this.logger.log('DLQ Consumer initialized', {
            environment: this.environmentService.getEnvironment(),
            queuesConfigured: this.queueMap.size,
        });
    }

    /**
     * Derive DLQ URL from main queue URL
     * Pattern: https://sqs.region.amazonaws.com/account/queue-name.fifo
     *       -> https://sqs.region.amazonaws.com/account/queue-name-dlq.fifo
     */
    private deriveDlqUrl(queueUrl: string): string {
        // Replace .fifo with -dlq.fifo
        if (queueUrl.endsWith('.fifo')) {
            return queueUrl.replace('.fifo', '-dlq.fifo');
        }

        // Fallback for non-FIFO queues (though all should be FIFO)
        const parts = queueUrl.split('/');
        const queueName = parts[parts.length - 1];
        return queueUrl.replace(queueName, `${queueName}-dlq`);
    }

    /**
     * Get DLQ message count for monitoring
     */
    async getDlqMessageCount(queueName: string): Promise<number> {
        return this.tracingService.withSpan('dlq.getMessageCount', async () => {
            const config = this.queueMap.get(queueName);
            if (!config) {
                throw new Error(`Queue not found: ${queueName}`);
            }

            try {
                const result = await this.client.send(
                    new GetQueueAttributesCommand({
                        QueueUrl: config.dlqUrl,
                        AttributeNames: ['ApproximateNumberOfMessages'],
                    }),
                );

                const count = parseInt(result.Attributes?.ApproximateNumberOfMessages || '0', 10);

                this.logger.debug(`DLQ message count for ${queueName}: ${count}`, {
                    queueName,
                    count,
                });

                return count;
            } catch (error) {
                this.logger.error(
                    `Failed to get DLQ message count for ${queueName}`,
                    error instanceof Error ? error.stack : undefined,
                    {
                        queueName,
                        error: error instanceof Error ? error.message : 'Unknown',
                    },
                );
                return 0;
            }
        });
    }

    /**
     * Get all DLQ message counts for monitoring dashboard
     */
    async getAllDlqMessageCounts(): Promise<Record<string, number>> {
        const counts: Record<string, number> = {};
        const queueNames = Array.from(this.queueMap.keys());

        await Promise.all(
            queueNames.map(async (queueName) => {
                counts[queueName] = await this.getDlqMessageCount(queueName);
            }),
        );

        return counts;
    }

    /**
     * Get dead letter messages for inspection
     * With deduplication to prevent showing duplicate messages
     */
    async getDeadLetters(queueName: string, maxMessages = 10): Promise<IDlqMessage[]> {
        return this.tracingService.withSpan('dlq.getDeadLetters', async () => {
            const config = this.queueMap.get(queueName);
            if (!config) {
                throw new Error(`Queue not found: ${queueName}`);
            }

            const result = await this.client.send(
                new ReceiveMessageCommand({
                    QueueUrl: config.dlqUrl,
                    MaxNumberOfMessages: Math.min(maxMessages, 10),
                    WaitTimeSeconds: 0,
                    AttributeNames: ['All'],
                    MessageAttributeNames: ['All'],
                }),
            );

            const messages = (result.Messages || [])
                .filter((m) => m.Body)
                .map((m) => {
                    // Use simdjson for parsing
                    const envelope = this.jsonService.parse<IMessageEnvelope>(m.Body!);
                    return {
                        originalMessage: envelope,
                        error: m.Attributes?.['ApproximateFirstReceiveTimestamp']
                            ? 'Max receive count exceeded'
                            : 'Unknown error',
                        failedAt: this.dateService.nowISO(),
                        receiveCount: parseInt(m.Attributes?.ApproximateReceiveCount || '0', 10),
                        sourceQueue: queueName,
                        messageId: envelope.messageId,
                        idempotencyKey: envelope.idempotencyKey,
                    };
                });

            this.logger.log(`Retrieved ${messages.length} DLQ messages from ${queueName}`, {
                queueName,
                count: messages.length,
            });

            return messages;
        });
    }

    /**
     * Reprocess all DLQ messages with deduplication
     * Only reprocesses messages that haven't been recently processed
     */
    async reprocessAll(queueName: string): Promise<{ reprocessed: number; skipped: number; failed: number }> {
        return this.tracingService.withSpan('dlq.reprocessAll', async () => {
            const config = this.queueMap.get(queueName);
            if (!config) {
                throw new Error(`Queue not found: ${queueName}`);
            }

            let reprocessed = 0;
            let skipped = 0;
            let failed = 0;
            let hasMore = true;

            this.logger.log(`Starting DLQ reprocessing for ${queueName}`, { queueName });

            while (hasMore) {
                const result = await this.client.send(
                    new ReceiveMessageCommand({
                        QueueUrl: config.dlqUrl,
                        MaxNumberOfMessages: 10,
                        WaitTimeSeconds: 0,
                    }),
                );

                const messages = result.Messages || [];
                if (messages.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const msg of messages) {
                    try {
                        if (!msg.Body || !msg.ReceiptHandle) continue;

                        // Use simdjson for parsing
                        const envelope = this.jsonService.parse<IMessageEnvelope>(msg.Body);

                        // Build deduplication key for app-level idempotency
                        // Use idempotencyKey if available, otherwise messageId as fallback
                        const appDedupeKey = envelope.idempotencyKey || envelope.messageId;
                        const replayTrackingKey = `dlq:replay:${queueName}:${appDedupeKey}`;

                        // Check if this message was already reprocessed recently (within 24 hours)
                        // This prevents infinite loops if message keeps failing
                        const alreadyReplayed = await this.idempotencyService.isDuplicate(replayTrackingKey);

                        if (alreadyReplayed) {
                            this.logger.warn(
                                `Message already replayed recently, skipping: ${envelope.messageId}`,
                                {
                                    messageId: envelope.messageId,
                                    idempotencyKey: envelope.idempotencyKey,
                                    queueName,
                                },
                            );
                            // Delete from DLQ to avoid reprocessing
                            await this.client.send(
                                new DeleteMessageCommand({
                                    QueueUrl: config.dlqUrl,
                                    ReceiptHandle: msg.ReceiptHandle,
                                }),
                            );
                            skipped++;
                            continue;
                        }

                        // Mark as being replayed (24 hour TTL)
                        await this.idempotencyService.markProcessed(replayTrackingKey, { replayed: true }, { ttl: 86400 });

                        // AWS SQS FIFO deduplication ID for replay
                        // Use static prefix to allow replay even if original send is within 5-min window
                        // But ensure same replay isn't sent twice (use messageId for uniqueness per DLQ entry)
                        const awsDedupeId = `dlq-replay-${envelope.messageId}`;

                        // Send back to main queue with reprocessed flag
                        await this.client.send(
                            new SendMessageCommand({
                                QueueUrl: config.queueUrl,
                                MessageBody: msg.Body,
                                MessageGroupId: envelope.tenantId || 'system', // Required for FIFO
                                MessageDeduplicationId: awsDedupeId, // Static per message, not timestamp-based
                                MessageAttributes: {
                                    reprocessed: {
                                        DataType: 'String',
                                        StringValue: 'true',
                                    },
                                    originalFailedAt: {
                                        DataType: 'String',
                                        StringValue: this.dateService.nowISO(),
                                    },
                                    replayAttempt: {
                                        DataType: 'Number',
                                        StringValue: '1',
                                    },
                                },
                            }),
                        );

                        // Delete from DLQ only after successful requeue
                        await this.client.send(
                            new DeleteMessageCommand({
                                QueueUrl: config.dlqUrl,
                                ReceiptHandle: msg.ReceiptHandle,
                            }),
                        );

                        reprocessed++;

                        this.logger.log(`Replayed DLQ message: ${envelope.messageId}`, {
                            messageId: envelope.messageId,
                            idempotencyKey: envelope.idempotencyKey,
                            queueName,
                        });
                    } catch (error) {
                        this.logger.error(
                            'Failed to reprocess DLQ message',
                            error instanceof Error ? error.stack : undefined,
                            {
                                error: error instanceof Error ? error.message : 'Unknown',
                                queueName,
                            },
                        );
                        failed++;
                    }
                }
            }

            this.logger.log(`DLQ reprocessing completed for ${queueName}`, {
                queueName,
                reprocessed,
                skipped,
                failed,
            });

            return { reprocessed, skipped, failed };
        });
    }

    /**
     * Purge all messages from DLQ
     * Use with caution - this permanently deletes messages
     */
    async purge(queueName: string): Promise<number> {
        return this.tracingService.withSpan('dlq.purge', async () => {
            const config = this.queueMap.get(queueName);
            if (!config) {
                throw new Error(`Queue not found: ${queueName}`);
            }

            let purged = 0;
            let hasMore = true;

            this.logger.warn(`Starting DLQ purge for ${queueName} - This will permanently delete messages!`, {
                queueName,
            });

            while (hasMore) {
                const result = await this.client.send(
                    new ReceiveMessageCommand({
                        QueueUrl: config.dlqUrl,
                        MaxNumberOfMessages: 10,
                        WaitTimeSeconds: 0,
                    }),
                );

                const messages = result.Messages || [];
                if (messages.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const msg of messages) {
                    if (msg.ReceiptHandle) {
                        await this.client.send(
                            new DeleteMessageCommand({
                                QueueUrl: config.dlqUrl,
                                ReceiptHandle: msg.ReceiptHandle,
                            }),
                        );
                        purged++;
                    }
                }
            }

            this.logger.warn(`DLQ purge completed for ${queueName}`, {
                queueName,
                purged,
            });

            return purged;
        });
    }

    /**
     * Get list of all configured queues with their DLQ URLs
     */
    getConfiguredQueues(): Array<{ name: string; queueUrl: string; dlqUrl: string }> {
        return Array.from(this.queueMap.entries()).map(([name, config]) => ({
            name,
            queueUrl: config.queueUrl,
            dlqUrl: config.dlqUrl,
        }));
    }

    /**
     * Get list of all configured queue names
     */
    getQueueNames(): string[] {
        return Array.from(this.queueMap.keys());
    }
}
