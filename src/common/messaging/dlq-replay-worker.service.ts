import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import {
    SQSClient,
    SendMessageCommand,
    DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { LRUCache } from 'lru-cache';
import type { AllConfigType } from '@app/config/config.type';
import type {
    IDlqReplayJobData,
    IJobResult,
    IWorkerConfig,
    IMessageEnvelope,
} from '@app/types';
import { BaseWorkerService, BullJobsConnectionFactory } from '@app/common/bulljobs';
import { IdempotencyService } from '@app/common/idempotency';
import { EnvironmentService } from '@app/common/helper/environment.service';
import { JsonService } from '@app/common/helper/json.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { MetricsService } from '@app/common/monitoring/metrics.service';
import { TracingService } from '@app/common/monitoring/tracing.module';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { DateService } from '@app/common/helper/date.service';

/**
 * BullMQ Worker for replaying DLQ messages
 *
 * Benefits over synchronous replay:
 * - Distributed processing across multiple workers
 * - Built-in retry with exponential backoff
 * - Rate limiting to prevent overwhelming the main queue
 * - Better observability and metrics
 * - Non-blocking - API calls return immediately
 *
 * Queue name: 'dlq-replay'
 */
@Injectable()
export class DlqReplayWorkerService extends BaseWorkerService<IDlqReplayJobData> implements OnModuleInit {
    private sqsClient: SQSClient;
    private readonly queueMap: LRUCache<string, { queueUrl: string; dlqUrl: string }>;

    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: ClsTenantContextService,
        dateService: DateService,
        private readonly environmentService: EnvironmentService,
        private readonly idempotencyService: IdempotencyService,
        private readonly jsonService: JsonService,
    ) {
        super(
            'dlq-replay',
            connectionFactory,
            configService,
            logger,
            metricsService,
            tracingService,
            tenantContext,
            dateService,
        );

        // Build queue map
        this.queueMap = new LRUCache<string, { queueUrl: string; dlqUrl: string }>({
            max: 100,
            ttl: 1000 * 60 * 60 * 24, // 24 hours
        });

        const queues = this.configService.getOrThrow('aws.sqs.queues', { infer: true });
        for (const queue of queues) {
            const dlqUrl = this.deriveDlqUrl(queue.url);
            this.queueMap.set(queue.name, {
                queueUrl: queue.url,
                dlqUrl,
            });
        }
    }

    async onModuleInit(): Promise<void> {
        await super.onModuleInit();

        // Initialize SQS client
        const awsConfig = this.environmentService.getAwsClientConfig();
        this.sqsClient = new SQSClient(awsConfig);

        this.logger.log('DLQ Replay Worker initialized', {
            queuesConfigured: this.queueMap.size,
        });
    }

    /**
     * Derive DLQ URL from main queue URL
     */
    private deriveDlqUrl(queueUrl: string): string {
        if (queueUrl.endsWith('.fifo')) {
            return queueUrl.replace('.fifo', '-dlq.fifo');
        }
        const parts = queueUrl.split('/');
        const queueName = parts[parts.length - 1];
        return queueUrl.replace(queueName, `${queueName}-dlq`);
    }

    /**
     * Configure worker for DLQ replay
     */
    protected getWorkerConfig(): IWorkerConfig {
        return {
            concurrency: 5, // Conservative concurrency for replays
            limiter: {
                max: 20, // Max 20 replays per second to avoid overwhelming main queue
                duration: 1000,
            },
        };
    }

    /**
     * Process a single DLQ replay job
     */
    protected async processJob(job: Job<IDlqReplayJobData>): Promise<IJobResult> {
        const {
            queueName,
            messageBody,
            receiptHandle,
            originalMessageId,
            originalIdempotencyKey,
        } = job.data;

        this.logger.debug(`Replaying DLQ message: ${originalMessageId}`, {
            queueName,
            originalMessageId,
            originalIdempotencyKey,
        });

        const config = this.queueMap.get(queueName);
        if (!config) {
            throw new Error(`Queue not configured: ${queueName}`);
        }

        // Check if already replayed recently (prevent infinite loops)
        const appDedupeKey = originalIdempotencyKey || originalMessageId;
        const replayTrackingKey = `dlq:replay:${queueName}:${appDedupeKey}`;

        const alreadyReplayed = await this.idempotencyService.isDuplicate(replayTrackingKey);
        if (alreadyReplayed) {
            this.logger.warn(`Message already replayed recently, skipping: ${originalMessageId}`);

            // Still delete from DLQ to clean up
            await this.deleteFromDlq(config.dlqUrl, receiptHandle);

            return {
                success: true,
                data: { skipped: true, reason: 'already_replayed' },
            };
        }

        // Mark as being replayed (24 hour TTL)
        await this.idempotencyService.markProcessed(
            replayTrackingKey,
            { replayed: true, replayedAt: this.dateService.nowISO() },
            { ttl: 86400 },
        );

        // Parse envelope to get tenant ID for message group
        const envelope = this.jsonService.parse<IMessageEnvelope>(messageBody);
        const awsDedupeId = `dlq-replay-${originalMessageId}`;

        // Send back to main queue
        await this.sqsClient.send(
            new SendMessageCommand({
                QueueUrl: config.queueUrl,
                MessageBody: messageBody,
                MessageGroupId: envelope.tenantId || 'system',
                MessageDeduplicationId: awsDedupeId,
                MessageAttributes: {
                    reprocessed: {
                        DataType: 'String',
                        StringValue: 'true',
                    },
                    originalFailedAt: {
                        DataType: 'String',
                        StringValue: this.dateService.nowISO(),
                    },
                    replayJobId: {
                        DataType: 'String',
                        StringValue: job.id || 'unknown',
                    },
                },
            }),
        );

        // Delete from DLQ after successful requeue
        await this.deleteFromDlq(config.dlqUrl, receiptHandle);

        this.logger.log(`Successfully replayed DLQ message: ${originalMessageId}`, {
            queueName,
            originalMessageId,
        });

        return { success: true };
    }

    /**
     * Delete message from DLQ
     */
    private async deleteFromDlq(dlqUrl: string, receiptHandle: string): Promise<void> {
        await this.sqsClient.send(
            new DeleteMessageCommand({
                QueueUrl: dlqUrl,
                ReceiptHandle: receiptHandle,
            }),
        );
    }

    /**
     * Check if error is unrecoverable
     */
    protected isUnrecoverableError(error: unknown): boolean {
        if (error instanceof Error) {
            const unrecoverableMessages = [
                'queue not configured',
                'invalid message',
                'malformed',
            ];
            return unrecoverableMessages.some((msg) => error.message.toLowerCase().includes(msg));
        }
        return false;
    }
}