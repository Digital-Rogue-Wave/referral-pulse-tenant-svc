import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { AppModule } from '@app/app.module';
import { SqsProducerService } from '@app/common/messaging/sqs-producer.service';
import { MessageProcessorService } from '@app/common/messaging/message-processor.service';
import { RedisService } from '@app/common/redis/redis.service';
import { IdempotencyService } from '@app/common/idempotency';
import type { IMessageEnvelope } from '@app/types';

interface TestOrderPayload {
    orderId: string;
    amount: number;
}

@Injectable()
class TestOrderService {
    private processedOrders: string[] = [];

    async processOrder(orderId: string, amount: number): Promise<void> {
        this.processedOrders.push(orderId);
    }

    getProcessedOrders(): string[] {
        return this.processedOrders;
    }

    reset(): void {
        this.processedOrders = [];
    }
}

describe('SQS Idempotency (e2e)', () => {
    let app: INestApplication;
    let sqsProducer: SqsProducerService;
    let messageProcessor: MessageProcessorService;
    let redisService: RedisService;
    let idempotencyService: IdempotencyService;
    let testOrderService: TestOrderService;
    let sqsClient: SQSClient;

    const TEST_QUEUE = 'test-orders-queue';
    const TEST_QUEUE_URL = `http://localhost:4566/000000000000/${TEST_QUEUE}.fifo`;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
            providers: [TestOrderService],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        sqsProducer = moduleFixture.get<SqsProducerService>(SqsProducerService);
        messageProcessor = moduleFixture.get<MessageProcessorService>(MessageProcessorService);
        redisService = moduleFixture.get<RedisService>(RedisService);
        idempotencyService = moduleFixture.get<IdempotencyService>(IdempotencyService);
        testOrderService = moduleFixture.get<TestOrderService>(TestOrderService);

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
        testOrderService.reset();
        await redisService.getClient().flushdb();
    });

    describe('Business-domain idempotency keys', () => {
        it('should prevent duplicate processing with same idempotency key', async () => {
            const orderId = ulid();
            const payload: TestOrderPayload = { orderId, amount: 100 };

            // Send message twice with same idempotency key
            await sqsProducer.send(TEST_QUEUE, 'order.created', payload, {
                idempotencyKey: `order-created-${orderId}`,
                messageGroupId: 'test-group',
            });

            await sqsProducer.send(TEST_QUEUE, 'order.created', payload, {
                idempotencyKey: `order-created-${orderId}`,
                messageGroupId: 'test-group',
            });

            // Receive and process messages
            const messages = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 2,
                }),
            );

            expect(messages.Messages).toBeDefined();
            expect(messages.Messages!.length).toBeGreaterThan(0);

            for (const message of messages.Messages!) {
                await messageProcessor.process<TestOrderPayload>(
                    message,
                    async (envelope) => {
                        await testOrderService.processOrder(envelope.payload.orderId, envelope.payload.amount);
                    },
                    { queueName: TEST_QUEUE },
                );

                // Delete message
                await sqsClient.send(
                    new DeleteMessageCommand({
                        QueueUrl: TEST_QUEUE_URL,
                        ReceiptHandle: message.ReceiptHandle,
                    }),
                );
            }

            // Should only process once
            expect(testOrderService.getProcessedOrders()).toHaveLength(1);
            expect(testOrderService.getProcessedOrders()[0]).toBe(orderId);
        });

        it('should process different orders even with similar data', async () => {
            const orderId1 = ulid();
            const orderId2 = ulid();
            const amount = 100;

            // Send two different orders
            await sqsProducer.send(
                TEST_QUEUE,
                'order.created',
                { orderId: orderId1, amount },
                {
                    idempotencyKey: `order-created-${orderId1}`,
                    messageGroupId: 'test-group',
                },
            );

            await sqsProducer.send(
                TEST_QUEUE,
                'order.created',
                { orderId: orderId2, amount },
                {
                    idempotencyKey: `order-created-${orderId2}`,
                    messageGroupId: 'test-group',
                },
            );

            // Process messages
            const messages = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 2,
                }),
            );

            for (const message of messages.Messages!) {
                await messageProcessor.process<TestOrderPayload>(
                    message,
                    async (envelope) => {
                        await testOrderService.processOrder(envelope.payload.orderId, envelope.payload.amount);
                    },
                    { queueName: TEST_QUEUE },
                );

                await sqsClient.send(
                    new DeleteMessageCommand({
                        QueueUrl: TEST_QUEUE_URL,
                        ReceiptHandle: message.ReceiptHandle,
                    }),
                );
            }

            // Should process both
            expect(testOrderService.getProcessedOrders()).toHaveLength(2);
            expect(testOrderService.getProcessedOrders()).toContain(orderId1);
            expect(testOrderService.getProcessedOrders()).toContain(orderId2);
        });
    });

    describe('Fallback to messageId', () => {
        it('should use messageId for deduplication when no idempotency key provided', async () => {
            const orderId = ulid();
            const payload: TestOrderPayload = { orderId, amount: 100 };

            // Send without explicit idempotency key
            await sqsProducer.send(TEST_QUEUE, 'order.created', payload, {
                messageGroupId: 'test-group',
            });

            // Process message
            const messages = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 2,
                }),
            );

            const message = messages.Messages![0];

            // Process twice (simulating redelivery)
            await messageProcessor.process<TestOrderPayload>(
                message,
                async (envelope) => {
                    await testOrderService.processOrder(envelope.payload.orderId, envelope.payload.amount);
                },
                { queueName: TEST_QUEUE },
            );

            await messageProcessor.process<TestOrderPayload>(
                message,
                async (envelope) => {
                    await testOrderService.processOrder(envelope.payload.orderId, envelope.payload.amount);
                },
                { queueName: TEST_QUEUE },
            );

            // Should only process once (messageId dedup)
            expect(testOrderService.getProcessedOrders()).toHaveLength(1);

            await sqsClient.send(
                new DeleteMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    ReceiptHandle: message.ReceiptHandle,
                }),
            );
        });
    });

    describe('Visibility timeout redelivery', () => {
        it('should deduplicate redelivered message after visibility timeout', async () => {
            const orderId = ulid();
            const payload: TestOrderPayload = { orderId, amount: 100 };

            await sqsProducer.send(TEST_QUEUE, 'order.created', payload, {
                idempotencyKey: `order-created-${orderId}`,
                messageGroupId: 'test-group',
            });

            // Receive message (1st delivery)
            const messages1 = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    MaxNumberOfMessages: 1,
                    VisibilityTimeout: 1, // 1 second
                }),
            );

            const message1 = messages1.Messages![0];

            // Process message
            await messageProcessor.process<TestOrderPayload>(
                message1,
                async (envelope) => {
                    await testOrderService.processOrder(envelope.payload.orderId, envelope.payload.amount);
                },
                { queueName: TEST_QUEUE },
            );

            // Wait for visibility timeout to expire
            await new Promise((resolve) => setTimeout(resolve, 1500));

            // Receive message again (redelivery)
            const messages2 = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    MaxNumberOfMessages: 1,
                    WaitTimeSeconds: 2,
                }),
            );

            if (messages2.Messages && messages2.Messages.length > 0) {
                const message2 = messages2.Messages[0];

                // Process redelivered message
                await messageProcessor.process<TestOrderPayload>(
                    message2,
                    async (envelope) => {
                        await testOrderService.processOrder(envelope.payload.orderId, envelope.payload.amount);
                    },
                    { queueName: TEST_QUEUE },
                );

                // Clean up
                await sqsClient.send(
                    new DeleteMessageCommand({
                        QueueUrl: TEST_QUEUE_URL,
                        ReceiptHandle: message2.ReceiptHandle,
                    }),
                );
            }

            // Should only process once despite redelivery
            expect(testOrderService.getProcessedOrders()).toHaveLength(1);
        });
    });

    describe('Manual idempotency check', () => {
        it('should detect duplicate via isDuplicate check', async () => {
            const idempotencyKey = `test-${ulid()}`;

            // First check
            const isDuplicate1 = await idempotencyService.isDuplicate(idempotencyKey);
            expect(isDuplicate1).toBe(false);

            // Mark as processed
            await idempotencyService.markProcessed(idempotencyKey, { processed: true }, { ttl: 60 });

            // Second check
            const isDuplicate2 = await idempotencyService.isDuplicate(idempotencyKey);
            expect(isDuplicate2).toBe(true);
        });

        it('should return original response via check method', async () => {
            const idempotencyKey = `test-${ulid()}`;
            const originalResponse = { orderId: ulid(), status: 'created' };

            // Mark as processed with response
            await idempotencyService.markProcessed(idempotencyKey, originalResponse, { ttl: 60 });

            // Check for duplicate
            const { isDuplicate, originalResponse: cached } = await idempotencyService.check(idempotencyKey);

            expect(isDuplicate).toBe(true);
            expect(cached).toEqual(originalResponse);
        });
    });

    describe('AWS FIFO deduplication', () => {
        it('should prevent duplicate sends within 5-minute window', async () => {
            const orderId = ulid();
            const payload: TestOrderPayload = { orderId, amount: 100 };
            const awsDedupeId = `dedup-${ulid()}`;

            // Send message twice with same AWS dedup ID
            await sqsProducer.send(TEST_QUEUE, 'order.created', payload, {
                idempotencyKey: `order-created-${orderId}`,
                messageDeduplicationId: awsDedupeId,
                messageGroupId: 'test-group',
            });

            // AWS should reject this (within 5-min window)
            await sqsProducer.send(TEST_QUEUE, 'order.created', payload, {
                idempotencyKey: `order-created-${orderId}`,
                messageDeduplicationId: awsDedupeId,
                messageGroupId: 'test-group',
            });

            // Receive messages
            const messages = await sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: TEST_QUEUE_URL,
                    MaxNumberOfMessages: 10,
                    WaitTimeSeconds: 2,
                }),
            );

            // Should only receive one message (AWS deduplicated)
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
    });
});