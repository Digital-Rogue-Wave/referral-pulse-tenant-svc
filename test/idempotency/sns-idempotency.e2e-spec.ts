import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { SNSClient, ListSubscriptionsByTopicCommand } from '@aws-sdk/client-sns';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { AppModule } from '@app/app.module';
import { SnsPublisherService } from '@app/common/messaging/sns-publisher.service';
import { MessageProcessorService } from '@app/common/messaging/message-processor.service';
import { RedisService } from '@app/common/redis/redis.service';

interface TestNotificationPayload {
    notificationId: string;
    message: string;
}

@Injectable()
class TestNotificationService {
    private receivedNotifications: string[] = [];

    async handleNotification(notificationId: string, message: string): Promise<void> {
        this.receivedNotifications.push(notificationId);
    }

    getReceivedNotifications(): string[] {
        return this.receivedNotifications;
    }

    reset(): void {
        this.receivedNotifications = [];
    }
}

describe('SNS Idempotency (e2e)', () => {
    let app: INestApplication;
    let snsPublisher: SnsPublisherService;
    let messageProcessor: MessageProcessorService;
    let redisService: RedisService;
    let testNotificationService: TestNotificationService;
    let snsClient: SNSClient;
    let sqsClient: SQSClient;

    const TEST_TOPIC = 'test-notifications-topic';
    const TEST_QUEUE_URL = `http://localhost:4566/000000000000/test-notifications-queue.fifo`;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
            providers: [TestNotificationService],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        snsPublisher = moduleFixture.get<SnsPublisherService>(SnsPublisherService);
        messageProcessor = moduleFixture.get<MessageProcessorService>(MessageProcessorService);
        redisService = moduleFixture.get<RedisService>(RedisService);
        testNotificationService = moduleFixture.get<TestNotificationService>(TestNotificationService);

        snsClient = new SNSClient({
            region: 'eu-central-1',
            endpoint: 'http://localhost:4566',
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test',
            },
        });

        sqsClient = new SQSClient({
            region: 'eu-central-1',
            endpoint: 'http://localhost:4566',
            credentials: {
                accessKeyId: 'test',
                secretAccessKey: 'test',
            },
        });
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        testNotificationService.reset();
        await redisService.getClient().flushdb();
    });

    describe('SNS FIFO deduplication', () => {
        it('should prevent duplicate publishes with same deduplication ID', async () => {
            const notificationId = ulid();
            const payload: TestNotificationPayload = {
                notificationId,
                message: 'Test notification',
            };
            const awsDedupeId = `dedup-${ulid()}`;

            // Publish twice with same AWS dedup ID
            await snsPublisher.publish(TEST_TOPIC, 'notification.sent', payload, {
                idempotencyKey: `notification-${notificationId}`,
                messageDeduplicationId: awsDedupeId,
                messageGroupId: 'test-group',
            });

            // AWS should reject this (within 5-min window)
            await snsPublisher.publish(TEST_TOPIC, 'notification.sent', payload, {
                idempotencyKey: `notification-${notificationId}`,
                messageDeduplicationId: awsDedupeId,
                messageGroupId: 'test-group',
            });

            // Wait for message propagation
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Receive from subscribed queue
            const messages = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 2,
                }),
            );

            // Should only receive one message (AWS deduplicated at SNS level)
            expect(messages.Messages).toBeDefined();
            expect(messages.Messages!.length).toBe(1);

            // Clean up
            for (const message of messages.Messages!) {
                await sqsClient.send(
                    new DeleteMessageCommand({
                        QueueUrl: TEST_QUEUE_URL,
                        ReceiptHandle: message.ReceiptHandle,
                    }),
                );
            }
        });

        it('should use idempotencyKey as fallback for AWS deduplication', async () => {
            const notificationId = ulid();
            const payload: TestNotificationPayload = {
                notificationId,
                message: 'Test notification',
            };
            const idempotencyKey = `notification-${notificationId}`;

            // Publish twice with same idempotency key (no explicit AWS dedup ID)
            await snsPublisher.publish(TEST_TOPIC, 'notification.sent', payload, {
                idempotencyKey,
                messageGroupId: 'test-group',
            });

            // Should use idempotencyKey as MessageDeduplicationId
            await snsPublisher.publish(TEST_TOPIC, 'notification.sent', payload, {
                idempotencyKey,
                messageGroupId: 'test-group',
            });

            await new Promise((resolve) => setTimeout(resolve, 1000));

            const messages = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 2,
                }),
            );

            // Should deduplicate at AWS level
            expect(messages.Messages!.length).toBe(1);

            for (const message of messages.Messages!) {
                await sqsClient.send(
                    new DeleteMessageCommand({
                        QueueUrl: TEST_QUEUE_URL,
                        ReceiptHandle: message.ReceiptHandle,
                    }),
                );
            }
        });
    });

    describe('Application-level idempotency after SNS', () => {
        it('should prevent duplicate processing by consumers', async () => {
            const notificationId = ulid();
            const payload: TestNotificationPayload = {
                notificationId,
                message: 'Test notification',
            };

            // Publish once
            await snsPublisher.publish(TEST_TOPIC, 'notification.sent', payload, {
                idempotencyKey: `notification-${notificationId}`,
                messageGroupId: 'test-group',
            });

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Receive message
            const messages = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 2,
                }),
            );

            const message = messages.Messages![0];

            // Process twice (simulating redelivery or multiple consumers)
            await messageProcessor.process<TestNotificationPayload>(
                message,
                async (envelope) => {
                    await testNotificationService.handleNotification(
                        envelope.payload.notificationId,
                        envelope.payload.message,
                    );
                },
                { queueName: 'test-notifications-queue' },
            );

            await messageProcessor.process<TestNotificationPayload>(
                message,
                async (envelope) => {
                    await testNotificationService.handleNotification(
                        envelope.payload.notificationId,
                        envelope.payload.message,
                    );
                },
                { queueName: 'test-notifications-queue' },
            );

            // Should only process once
            expect(testNotificationService.getReceivedNotifications()).toHaveLength(1);
            expect(testNotificationService.getReceivedNotifications()[0]).toBe(notificationId);

            // Clean up
            await sqsClient.send(
                new DeleteMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    ReceiptHandle: message.ReceiptHandle,
                }),
            );
        });
    });

    describe('Fan-out scenario', () => {
        it('should deduplicate across multiple subscribed queues', async () => {
            const notificationId = ulid();
            const payload: TestNotificationPayload = {
                notificationId,
                message: 'Broadcast notification',
            };
            const idempotencyKey = `broadcast-${notificationId}`;

            // Publish once to topic (fans out to multiple queues)
            await snsPublisher.publish(TEST_TOPIC, 'notification.broadcast', payload, {
                idempotencyKey,
                messageGroupId: 'test-group',
            });

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Each subscribed queue receives the message
            const messages = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 2,
                }),
            );

            expect(messages.Messages).toBeDefined();
            expect(messages.Messages!.length).toBeGreaterThan(0);

            // Process all messages from queue
            for (const message of messages.Messages!) {
                await messageProcessor.process<TestNotificationPayload>(
                    message,
                    async (envelope) => {
                        await testNotificationService.handleNotification(
                            envelope.payload.notificationId,
                            envelope.payload.message,
                        );
                    },
                    { queueName: 'test-notifications-queue' },
                );

                await sqsClient.send(
                    new DeleteMessageCommand({
                        QueueUrl: TEST_QUEUE_URL,
                        ReceiptHandle: message.ReceiptHandle,
                    }),
                );
            }

            // Even with fan-out, idempotency key prevents duplicate processing
            expect(testNotificationService.getReceivedNotifications()).toHaveLength(1);
        });
    });

    describe('System messages without tenant context', () => {
        it('should publish system message with idempotency', async () => {
            const notificationId = ulid();
            const payload: TestNotificationPayload = {
                notificationId,
                message: 'System maintenance notification',
            };

            // Publish system message twice
            await snsPublisher.publishSystem(TEST_TOPIC, 'system.maintenance', payload);

            await snsPublisher.publishSystem(TEST_TOPIC, 'system.maintenance', payload);

            await new Promise((resolve) => setTimeout(resolve, 1000));

            const messages = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 2,
                }),
            );

            // Without explicit idempotency key, falls back to messageId (unique)
            // So we expect 2 messages (no dedup without explicit key)
            expect(messages.Messages!.length).toBe(2);

            // Clean up
            for (const message of messages.Messages!) {
                await sqsClient.send(
                    new DeleteMessageCommand({
                        QueueUrl: TEST_QUEUE_URL,
                        ReceiptHandle: message.ReceiptHandle,
                    }),
                );
            }
        });
    });

    describe('Separate app and AWS deduplication', () => {
        it('should allow different AWS dedup but same app idempotency key', async () => {
            const notificationId = ulid();
            const payload: TestNotificationPayload = {
                notificationId,
                message: 'Retry notification',
            };
            const appIdempotencyKey = `notification-${notificationId}`;

            // First send
            await snsPublisher.publish(TEST_TOPIC, 'notification.sent', payload, {
                idempotencyKey: appIdempotencyKey,
                messageDeduplicationId: 'attempt-1',
                messageGroupId: 'test-group',
            });

            // Retry with different AWS dedup (allows resend)
            await snsPublisher.publish(TEST_TOPIC, 'notification.sent', payload, {
                idempotencyKey: appIdempotencyKey, // Same app key
                messageDeduplicationId: 'attempt-2', // Different AWS dedup
                messageGroupId: 'test-group',
            });

            await new Promise((resolve) => setTimeout(resolve, 1000));

            const messages = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 2,
                }),
            );

            // Should receive both (different AWS dedup)
            expect(messages.Messages!.length).toBe(2);

            // Process both messages
            for (const message of messages.Messages!) {
                await messageProcessor.process<TestNotificationPayload>(
                    message,
                    async (envelope) => {
                        await testNotificationService.handleNotification(
                            envelope.payload.notificationId,
                            envelope.payload.message,
                        );
                    },
                    { queueName: 'test-notifications-queue' },
                );

                await sqsClient.send(
                    new DeleteMessageCommand({
                        QueueUrl: TEST_QUEUE_URL,
                        ReceiptHandle: message.ReceiptHandle,
                    }),
                );
            }

            // But app-level idempotency prevents duplicate processing
            expect(testNotificationService.getReceivedNotifications()).toHaveLength(1);
        });
    });
});