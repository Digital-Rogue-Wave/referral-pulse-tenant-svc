import { Injectable, Inject, Optional } from '@nestjs/common';
import { ulid } from 'ulid';
import { Prisma, SideEffectOutbox as SideEffectOutboxModel } from '@prisma-gen/generated/client';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type {
    ICreateSideEffectDto,
    ISqsSideEffectPayload,
    ISnsSideEffectPayload,
    IEmailSideEffectPayload,
    IAuditSideEffectPayload,
    IEmailAttachment,
    IOutboxJobData,
    IPublishOptions,
    SqsQueueName,
    SnsTopicName,
    EventType,
    BaseEventType,
    SideEffectType
} from '@app/types';

import { BullJobsService } from '@common/bulljobs';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { SnsPublisherService } from '@common/messaging/sns-publisher.service';
import { SqsProducerService } from '@common/messaging/sqs-producer.service';

import { DatabaseService } from '@app/database/database.service';

export const BULLJOBS_SERVICE = 'BULLJOBS_SERVICE';

/**
 * Options for side effect delivery
 */
export interface ISideEffectOptions {
    /**
     * If true, use outbox pattern (DB → BullMQ → SQS/SNS) for guaranteed delivery.
     * If false, send directly to SQS/SNS with DLQ (faster but no DB persistence).
     * @default true
     */
    critical?: boolean;

    /**
     * Prisma transaction client (only used when critical=true)
     */
    prisma?: Prisma.TransactionClient;

    /**
     * Idempotency key for deduplication
     */
    idempotencyKey?: string;

    /**
     * Message group ID for FIFO queues/topics
     */
    messageGroupId?: string;

    /**
     * Delay in seconds before message is available (SQS only)
     */
    delaySeconds?: number;

    /**
     * Schedule the side effect for future execution (outbox only)
     */
    scheduledAt?: Date;

    /**
     * Max retries for outbox pattern
     * @default 3
     */
    maxRetries?: number;

    /**
     * Additional metadata to store with the side effect
     */
    metadata?: Record<string, unknown>;
}

/**
 * Service for creating side effects with dual delivery modes:
 *
 * **Critical (outbox pattern)** - `critical: true` (default)
 * - Writes to DB outbox table
 * - BullMQ worker processes and sends to SQS/SNS
 * - Guaranteed delivery, survives crashes
 * - Transactional consistency with DB operations
 * - Use for: payment notifications, order confirmations, critical workflows
 *
 * **Non-critical (direct)** - `critical: false`
 * - Sends directly to SQS/SNS
 * - Faster, no DB overhead
 * - DLQ handles failures
 * - Use for: analytics, metrics, non-essential notifications
 */
@Injectable()
export class SideEffectService {
    private static readonly OUTBOX_QUEUE_NAME = 'outbox-processor';

    constructor(
        private readonly prisma: DatabaseService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService,
        private readonly sqsProducer: SqsProducerService,
        private readonly snsPublisher: SnsPublisherService,
        @Optional()
        @Inject(BULLJOBS_SERVICE)
        private readonly bullJobsService?: BullJobsService
    ) {
        this.logger.setContext(SideEffectService.name);
    }

    /**
     * Create a side effect (generic method)
     * Use convenience methods (createSqsSideEffect, createSnsSideEffect) for type safety
     */
    async createSideEffect(
        dto: ICreateSideEffectDto,
        options: ISideEffectOptions = {}
    ): Promise<SideEffectOutboxModel | { messageId: string; direct: true }> {
        const { critical = true, prisma: tx } = options;

        if (critical) {
            return this.createOutboxSideEffect(dto, tx, options);
        }

        // Direct delivery - no outbox
        return this.sendDirectSideEffect(dto, options);
    }

    /**
     * Create side effect in outbox (guaranteed delivery)
     */
    private async createOutboxSideEffect(
        dto: ICreateSideEffectDto,
        tx?: Prisma.TransactionClient,
        options: ISideEffectOptions = {}
    ): Promise<SideEffectOutboxModel> {
        const tenantId = this.tenantContext.getTenantId();
        const correlationId = this.tenantContext.getCorrelationId();

        if (!tenantId) {
            throw new Error('Tenant ID is required for side effect creation');
        }

        // Generate idempotency key if not provided
        const idempotencyKey = options.idempotencyKey || dto.idempotencyKey || `${dto.aggregateType}:${dto.aggregateId}:${dto.eventType}:${ulid()}`;

        // Use transaction client if provided, otherwise default prisma service
        const client = tx || this.prisma;

        // Create entity using Prisma
        const saved = await client.sideEffectOutbox.create({
            data: {
                tenantId,
                effectType: dto.effectType,
                aggregateType: dto.aggregateType,
                aggregateId: dto.aggregateId,
                eventType: dto.eventType,
                payload: dto.payload as Prisma.InputJsonValue,
                metadata: {
                    ...((dto.metadata as Record<string, unknown>) ?? {}),
                    ...(options.metadata ?? {}),
                    correlationId
                } as Prisma.InputJsonValue,
                scheduledAt: options.scheduledAt || dto.scheduledAt || new Date(),
                maxRetries: options.maxRetries ?? dto.maxRetries ?? 3,
                idempotencyKey,
                status: 'pending',
                retryCount: 0
            }
        });

        this.logger.log(`Created critical side effect: ${saved.id} [${dto.effectType}] for ${dto.aggregateType}:${dto.aggregateId}`);

        // Enqueue job to BullMQ for processing
        await this.enqueueJob(saved, options.scheduledAt);

        return saved;
    }

    /**
     * Send side effect directly to SQS/SNS (no outbox)
     */
    private async sendDirectSideEffect(dto: ICreateSideEffectDto, options: ISideEffectOptions = {}): Promise<{ messageId: string; direct: true }> {
        const publishOptions: IPublishOptions = {
            idempotencyKey: options.idempotencyKey || dto.idempotencyKey,
            messageGroupId: options.messageGroupId || this.tenantContext.getTenantId(),
            delaySeconds: options.delaySeconds
        };

        let messageId: string;

        switch (dto.effectType) {
            case 'sqs': {
                const payload = dto.payload as ISqsSideEffectPayload;
                messageId = await this.sqsProducer.send(payload.queueName, payload.eventType, payload.message, publishOptions);
                break;
            }
            case 'sns': {
                const payload = dto.payload as ISnsSideEffectPayload;
                messageId = await this.snsPublisher.publish(payload.topicName, payload.eventType, payload.message, publishOptions);
                break;
            }
            case 'email':
            case 'audit':
                // Email and audit always require outbox pattern
                throw new Error(`Direct delivery not supported for effect type: ${dto.effectType}. Use critical=true.`);
            default:
                throw new Error(`Unknown effect type: ${dto.effectType}`);
        }

        this.logger.log(`Sent direct side effect [${dto.effectType}] for ${dto.aggregateType}:${dto.aggregateId} - messageId: ${messageId}`);

        return { messageId, direct: true };
    }

    /**
     * Enqueue a side effect for processing via BullMQ
     */
    private async enqueueJob(sideEffect: SideEffectOutboxModel, scheduledAt?: Date): Promise<void> {
        if (!this.bullJobsService) {
            this.logger.debug('BullJobs service not available, side effect will be processed by cron fallback');
            return;
        }

        try {
            if (!sideEffect.effectType || !sideEffect.aggregateType || !sideEffect.aggregateId) {
                throw new Error(`Invalid side effect: missing required fields for ${sideEffect.id}`);
            }

            const jobData: IOutboxJobData = {
                sideEffectId: sideEffect.id,
                effectType: sideEffect.effectType as SideEffectType,
                aggregateType: sideEffect.aggregateType,
                aggregateId: sideEffect.aggregateId,
                eventType: sideEffect.eventType ?? 'unknown',
                tenantId: sideEffect.tenantId,
                correlationId: this.tenantContext.getCorrelationId(),
                userId: this.tenantContext.getUserId()
            };

            // Calculate delay if scheduled for the future
            const delay = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0;

            await this.bullJobsService.addJob(SideEffectService.OUTBOX_QUEUE_NAME, `process-${sideEffect.effectType}`, jobData, {
                jobId: sideEffect.id,
                delay,
                attempts: sideEffect.maxRetries,
                backoff: {
                    type: 'exponential',
                    delay: 5000
                },
                removeOnComplete: 100,
                removeOnFail: 500
            });

            this.logger.debug(`Enqueued side effect job: ${sideEffect.id}`, { delay });
        } catch (error) {
            this.logger.warn(`Failed to enqueue side effect job: ${sideEffect.id}`, { error: error instanceof Error ? error.message : 'Unknown' });
        }
    }

    /**
     * Create multiple side effects at once
     */
    async createSideEffects(
        dtos: Array<ICreateSideEffectDto & { options?: ISideEffectOptions }>
    ): Promise<Array<SideEffectOutboxModel | { messageId: string; direct: true }>> {
        return Promise.all(dtos.map((item) => this.createSideEffect(item, item.options)));
    }

    /**
     * Convenience method: Create SQS side effect
     */
    async createSqsSideEffect(
        aggregateType: string,
        aggregateId: string,
        eventType: EventType,
        queueName: SqsQueueName,
        message: Record<string, unknown>,
        options: ISideEffectOptions = {}
    ): Promise<SideEffectOutboxModel | { messageId: string; direct: true }> {
        const payload: ISqsSideEffectPayload = {
            queueName,
            eventType,
            message
        };

        return this.createSideEffect(
            {
                effectType: 'sqs',
                aggregateType,
                aggregateId,
                eventType,
                payload
            },
            options
        );
    }

    /**
     * Convenience method: Create email side effect
     */
    async createEmailSideEffect(
        aggregateType: string,
        aggregateId: string,
        eventType: string,
        to: string | string[],
        subject: string,
        body: string,
        emailOptions?: {
            from?: string;
            cc?: string | string[];
            bcc?: string | string[];
            attachments?: IEmailAttachment[];
            templateId?: string;
            templateVars?: Record<string, unknown>;
        },
        options: Omit<ISideEffectOptions, 'critical'> = {}
    ): Promise<SideEffectOutboxModel> {
        const payload: IEmailSideEffectPayload = {
            to,
            subject,
            body,
            ...emailOptions
        };

        const result = await this.createSideEffect(
            {
                effectType: 'email',
                aggregateType,
                aggregateId,
                eventType,
                payload
            },
            { ...options, critical: true } // Always critical
        );

        return result as SideEffectOutboxModel;
    }

    /**
     * Convenience method: Create audit log side effect
     */
    async createAuditSideEffect(
        aggregateType: string,
        aggregateId: string,
        eventType: string,
        action: string,
        changes: Record<string, unknown>,
        userId?: string,
        options: Omit<ISideEffectOptions, 'critical'> = {}
    ): Promise<SideEffectOutboxModel> {
        const payload: IAuditSideEffectPayload = {
            action,
            changes,
            userId,
            timestamp: new Date().toISOString()
        };

        const result = await this.createSideEffect(
            {
                effectType: 'audit',
                aggregateType,
                aggregateId,
                eventType,
                payload
            },
            { ...options, critical: true } // Always critical
        );

        return result as SideEffectOutboxModel;
    }

    /**
     * Convenience method: Broadcast event via SNS topic
     *
     * Publishes once to an SNS topic. Subscriber SQS queues are managed via
     * infrastructure (Terraform/CDK) — adding a new consumer requires zero code changes.
     *
     * @param aggregateType - Domain entity type (e.g., 'toto', 'campaign')
     * @param aggregateId - Entity ID that triggered the event
     * @param eventType - Event type (e.g., 'toto.created')
     * @param topicName - SNS topic to publish to
     * @param message - Event payload to broadcast
     * @param options - Side effect options (critical defaults to false)
     *
     * @example
     * ```typescript
     * await sideEffectService.createBroadcastSideEffect(
     *   'toto',
     *   toto.id,
     *   'toto.created',
     *   TOTO_EVENTS_TOPIC,
     *   { totoId: toto.id, name: toto.name, tenantId: toto.tenantId }
     * );
     * ```
     */
    async createBroadcastSideEffect(
        aggregateType: string,
        aggregateId: string,
        eventType: BaseEventType,
        topicName: SnsTopicName,
        message: Record<string, unknown>,
        options: ISideEffectOptions = {}
    ): Promise<SideEffectOutboxModel | { messageId: string; direct: true }> {
        const payload: ISnsSideEffectPayload = {
            topicName,
            eventType: eventType as EventType,
            message
        };

        const result = await this.createSideEffect(
            {
                effectType: 'sns',
                aggregateType,
                aggregateId,
                eventType: eventType as EventType,
                payload
            },
            {
                ...options,
                // Default to non-critical (fire-and-forget with DLQ on subscriber queues)
                critical: options.critical ?? false
            }
        );

        this.logger.log(`Broadcasted ${eventType} to topic ${topicName}`, {
            aggregateType,
            aggregateId,
            topicName
        });

        return result;
    }

    /**
     * Find all side effects for a specific aggregate
     */
    async findByAggregate(aggregateType: string, aggregateId: string): Promise<SideEffectOutboxModel[]> {
        return this.prisma.sideEffectOutbox.findMany({
            where: {
                aggregateType,
                aggregateId,
                tenantId: this.tenantContext.getTenantId()
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
    }

    /**
     * Get side effect statistics (for monitoring)
     */
    async getStats(): Promise<{
        pending: number;
        processing: number;
        completed: number;
        failed: number;
    }> {
        const tenantId = this.tenantContext.getTenantId();

        const [pending, processing, completed, failed] = await Promise.all([
            this.prisma.sideEffectOutbox.count({ where: { tenantId, status: 'pending' } }),
            this.prisma.sideEffectOutbox.count({ where: { tenantId, status: 'processing' } }),
            this.prisma.sideEffectOutbox.count({ where: { tenantId, status: 'completed' } }),
            this.prisma.sideEffectOutbox.count({ where: { tenantId, status: 'failed' } })
        ]);

        return { pending, processing, completed, failed };
    }
}
