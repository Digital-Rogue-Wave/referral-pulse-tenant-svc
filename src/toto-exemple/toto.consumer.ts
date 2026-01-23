import { Injectable } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { SqsMessageHandler, SqsConsumerEventHandler } from '@ssut/nestjs-sqs';
import { MessageProcessorService } from '@app/common/messaging';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { TotoService } from './toto.service';
import type { IMessageEnvelope } from '@app/types';

interface TotoCreatedPayload {
    totoId: string;
    name: string;
    tenantId: string;
    status: string;
    createdAt: Date;
}

interface TotoUpdatedPayload {
    totoId: string;
    name?: string;
    status?: string;
    tenantId: string;
    updatedAt: Date;
}

@Injectable()
export class TotoConsumer {
    constructor(
        private readonly messageProcessor: MessageProcessorService,
        private readonly totoService: TotoService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(TotoConsumer.name);
    }

    /**
     * Handle toto.created events from SQS
     *
     * Demonstrates consuming messages with automatic:
     * - Envelope parsing & validation
     * - Tenant context setup
     * - Idempotency checking (via MessageProcessorService)
     * - Metrics recording
     * - Structured logging with context
     * - Error handling & retry logic
     *
     * The MessageProcessorService automatically:
     * 1. Parses the message envelope
     * 2. Sets tenant context from envelope
     * 3. Checks idempotency (won't process duplicates)
     * 4. Records metrics (latency, success/failure)
     * 5. Handles errors and retries
     */
    @SqsMessageHandler('toto-events-queue', false)
    async handleTotoCreated(message: Message) {
        await this.messageProcessor.process<TotoCreatedPayload>(
            message,
            async (envelope: IMessageEnvelope<TotoCreatedPayload>) => {
                if (envelope.eventType === 'toto.created') {
                    this.logger.log(`Processing toto.created event`, {
                        messageId: envelope.messageId,
                        totoId: envelope.payload.totoId,
                        totoName: envelope.payload.name,
                        tenantId: envelope.payload.tenantId,
                        correlationId: envelope.correlationId,
                    });

                    // Simulate business logic processing
                    // Examples:
                    // - Send welcome notification
                    // - Update analytics/metrics
                    // - Trigger downstream workflows
                    // - Index in search engine

                    // Example: Log analytics event
                    this.logger.log(`Analytics: New toto created`, {
                        totoId: envelope.payload.totoId,
                        status: envelope.payload.status,
                        timestamp: envelope.payload.createdAt,
                    });

                    // Example: Simulate sending notification
                    this.logger.log(`Notification sent for new toto`, {
                        totoId: envelope.payload.totoId,
                        recipient: 'admin@example.com',
                    });

                    this.logger.log(`Successfully processed toto.created event`, {
                        messageId: envelope.messageId,
                        totoId: envelope.payload.totoId,
                    });
                }
            },
            { queueName: 'toto-events-queue' },
        );
    }

    /**
     * Handle toto.updated events from SQS
     *
     * Demonstrates:
     * - Change tracking
     * - Conditional processing based on changes
     * - Structured logging
     * - Side effects based on specific field changes
     */
    @SqsMessageHandler('toto-updates-queue', false)
    async handleTotoUpdated(message: Message) {
        await this.messageProcessor.process<TotoUpdatedPayload & { changes?: Record<string, { from: any; to: any }> }>(
            message,
            async (envelope) => {
                if (envelope.eventType === 'toto.updated') {
                    this.logger.log(`Processing toto.updated event`, {
                        messageId: envelope.messageId,
                        totoId: envelope.payload.totoId,
                        tenantId: envelope.payload.tenantId,
                        correlationId: envelope.correlationId,
                        changes: envelope.payload.changes,
                    });

                    // Example: Process specific field changes
                    if (envelope.payload.changes) {
                        const changes = envelope.payload.changes;

                        // Status change - trigger specific workflow
                        if (changes.status) {
                            this.logger.log(`Status changed for toto`, {
                                totoId: envelope.payload.totoId,
                                from: changes.status.from,
                                to: changes.status.to,
                            });

                            // Example: Send notification on status change
                            if (changes.status.to === 'completed') {
                                this.logger.log(`Toto completed - sending completion notification`, {
                                    totoId: envelope.payload.totoId,
                                });
                            }
                        }

                        // Name change - update search index
                        if (changes.name) {
                            this.logger.log(`Name changed for toto`, {
                                totoId: envelope.payload.totoId,
                                oldName: changes.name.from,
                                newName: changes.name.to,
                            });
                        }
                    }

                    this.logger.log(`Successfully processed toto.updated event`, {
                        messageId: envelope.messageId,
                        totoId: envelope.payload.totoId,
                    });
                }
            },
            { queueName: 'toto-updates-queue' },
        );
    }

    /**
     * Handle processing errors for toto-events-queue
     *
     * Demonstrates:
     * - Structured error logging with context
     * - Error metadata capture
     * - Retry tracking
     */
    @SqsConsumerEventHandler('toto-events-queue', 'processing_error')
    onTotoEventsError(error: Error, message: Message) {
        const context = {
            messageId: message.MessageId,
            receiptHandle: message.ReceiptHandle,
            approximateReceiveCount: message.Attributes?.ApproximateReceiveCount,
            error: error.message,
            messageBody: message.Body,
        };

        this.logger.error(
            `Error processing toto-events-queue message: ${JSON.stringify(context)}`,
            error.stack,
        );

        // Optional: Alert on repeated failures
        const receiveCount = parseInt(message.Attributes?.ApproximateReceiveCount || '0', 10);
        if (receiveCount > 3) {
            this.logger.warn(
                `Message failed multiple times - may need intervention: messageId=${message.MessageId}, count=${receiveCount}`,
            );
        }
    }

    /**
     * Handle processing errors for toto-updates-queue
     */
    @SqsConsumerEventHandler('toto-updates-queue', 'processing_error')
    onTotoUpdatesError(error: Error, message: Message) {
        const context = {
            messageId: message.MessageId,
            receiptHandle: message.ReceiptHandle,
            approximateReceiveCount: message.Attributes?.ApproximateReceiveCount,
            error: error.message,
        };

        this.logger.error(
            `Error processing toto-updates-queue message: ${JSON.stringify(context)}`,
            error.stack,
        );
    }
}