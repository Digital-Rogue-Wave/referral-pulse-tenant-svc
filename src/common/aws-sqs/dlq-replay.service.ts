import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { AppLoggingService } from '@mod/common/logger/app-logging.service';
import { MonitoringService } from '@mod/common/monitoring/monitoring.service';
import sqsConfig from '@mod/config/sqs.config';

export interface ReplayResult {
    totalProcessed: number;
    successful: number;
    failed: number;
    errors: Array<{ messageId: string; error: string }>;
}

@Injectable()
export class DlqReplayService {
    private readonly sqsClient: SQSClient;
    private readonly dlqMap = new Map<string, { dlqUrl: string; mainQueueUrl: string }>();

    constructor(
        private readonly logger: AppLoggingService,
        private readonly metrics: MonitoringService,
        private readonly config: ConfigService
    ) {
        const awsRegion = this.config.getOrThrow<string>('awsConfig.region', { infer: true });
        this.sqsClient = new SQSClient({ region: awsRegion });

        // Build DLQ to main queue mapping
        const cfg = this.config.getOrThrow<ConfigType<typeof sqsConfig>>('sqsConfig', { infer: true });

        for (const consumer of cfg.consumers) {
            if (consumer.dlqUrl) {
                this.dlqMap.set(consumer.name, {
                    dlqUrl: consumer.dlqUrl,
                    mainQueueUrl: consumer.queueUrl
                });
            }
        }
    }

    /**
     * Get DLQ message count
     */
    async getDlqDepth(queueName: string): Promise<number> {
        const queueInfo = this.dlqMap.get(queueName);
        if (!queueInfo) {
            throw new Error(`No DLQ configured for queue: ${queueName}`);
        }

        const command = new GetQueueAttributesCommand({
            QueueUrl: queueInfo.dlqUrl,
            AttributeNames: ['ApproximateNumberOfMessages']
        });

        const response = await this.sqsClient.send(command);
        const count = response.Attributes?.ApproximateNumberOfMessages;

        return count ? parseInt(count, 10) : 0;
    }

    /**
     * Replay messages from DLQ back to main queue
     */
    async replayDlqMessages(queueName: string, maxMessages: number = 10): Promise<ReplayResult> {
        const queueInfo = this.dlqMap.get(queueName);
        if (!queueInfo) {
            throw new Error(`No DLQ configured for queue: ${queueName}`);
        }

        const result: ReplayResult = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            errors: []
        };

        this.logger.info(`Starting DLQ replay - queue: ${queueName}, maxMessages: ${maxMessages}, dlqUrl: ${queueInfo.dlqUrl}`);

        // Receive messages from DLQ
        const receiveCommand = new ReceiveMessageCommand({
            QueueUrl: queueInfo.dlqUrl,
            MaxNumberOfMessages: Math.min(maxMessages, 10), // SQS max is 10
            WaitTimeSeconds: 0,
            MessageAttributeNames: ['All'],
            AttributeNames: ['All']
        });

        const receiveResponse = await this.sqsClient.send(receiveCommand);
        const messages = receiveResponse.Messages || [];

        if (messages.length === 0) {
            this.logger.info(`No messages in DLQ - queue: ${queueName}`);
            return result;
        }

        // Replay each message
        for (const message of messages) {
            result.totalProcessed++;

            try {
                // Send message back to main queue
                const sendCommand = new SendMessageCommand({
                    QueueUrl: queueInfo.mainQueueUrl,
                    MessageBody: message.Body,
                    MessageAttributes: message.MessageAttributes
                });

                await this.sqsClient.send(sendCommand);

                // Delete from DLQ after successful replay
                const deleteCommand = new DeleteMessageCommand({
                    QueueUrl: queueInfo.dlqUrl,
                    ReceiptHandle: message.ReceiptHandle!
                });

                await this.sqsClient.send(deleteCommand);

                result.successful++;

                this.logger.info(`Replayed DLQ message - queue: ${queueName}, messageId: ${message.MessageId}`);
            } catch (error) {
                result.failed++;
                result.errors.push({
                    messageId: message.MessageId || 'unknown',
                    error: (error as Error).message
                });

                this.logger.error(
                    `Failed to replay DLQ message - queue: ${queueName}, messageId: ${message.MessageId}, error: ${(error as Error).message}`
                );
            }
        }

        // Record metrics
        this.metrics.incrementCounter('sqs_dlq_replayed', result.successful, {
            queue: queueName,
            status: 'success'
        });

        if (result.failed > 0) {
            this.metrics.incrementCounter('sqs_dlq_replayed', result.failed, {
                queue: queueName,
                status: 'failed'
            });
        }

        this.logger.info(
            `DLQ replay completed - queue: ${queueName}, processed: ${result.totalProcessed}, successful: ${result.successful}, failed: ${result.failed}`
        );

        return result;
    }

    /**
     * Replay all messages from DLQ (careful - use with caution)
     */
    async replayAllDlqMessages(queueName: string): Promise<ReplayResult> {
        const totalResult: ReplayResult = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            errors: []
        };

        let hasMoreMessages = true;

        while (hasMoreMessages) {
            const batchResult = await this.replayDlqMessages(queueName, 10);

            totalResult.totalProcessed += batchResult.totalProcessed;
            totalResult.successful += batchResult.successful;
            totalResult.failed += batchResult.failed;
            totalResult.errors.push(...batchResult.errors);

            // Stop if no messages were processed in this batch
            if (batchResult.totalProcessed === 0) {
                hasMoreMessages = false;
            }
        }

        return totalResult;
    }

    /**
     * Peek at DLQ messages without deleting
     */
    async peekDlqMessages(queueName: string, maxMessages: number = 10) {
        const queueInfo = this.dlqMap.get(queueName);
        if (!queueInfo) {
            throw new Error(`No DLQ configured for queue: ${queueName}`);
        }

        const command = new ReceiveMessageCommand({
            QueueUrl: queueInfo.dlqUrl,
            MaxNumberOfMessages: Math.min(maxMessages, 10),
            WaitTimeSeconds: 0,
            MessageAttributeNames: ['All'],
            AttributeNames: ['All'],
            VisibilityTimeout: 0 // Make visible immediately after peek
        });

        const response = await this.sqsClient.send(command);
        return response.Messages || [];
    }

    /**
     * Get all queues with DLQ depths
     */
    async getAllDlqDepths(): Promise<Map<string, number>> {
        const depths = new Map<string, number>();

        for (const queueName of this.dlqMap.keys()) {
            try {
                const depth = await this.getDlqDepth(queueName);
                depths.set(queueName, depth);

                // Warn if DLQ has messages
                if (depth > 0) {
                    this.logger.warn(`DLQ has messages - queue: ${queueName}, depth: ${depth}`);
                }
            } catch (error) {
                this.logger.error(`Failed to get DLQ depth - queue: ${queueName}, error: ${(error as Error).message}`);
            }
        }

        return depths;
    }
}
