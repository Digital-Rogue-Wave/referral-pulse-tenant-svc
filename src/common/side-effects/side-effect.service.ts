import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { SideEffectOutboxEntity } from './side-effect-outbox.entity';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { BullJobsService } from '@app/common/bulljobs';
import { SqsProducerService } from '@app/common/messaging/sqs-producer.service';
import { SnsPublisherService } from '@app/common/messaging/sns-publisher.service';
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
} from '@app/types';
import { ulid } from 'ulid';

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
     * EntityManager for transaction context (only used when critical=true)
     */
    manager?: EntityManager;

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
 *
 * @example
 * ```typescript
 * // Critical: outbox pattern (guaranteed delivery)
 * await this.sideEffectService.createSqsSideEffect(
 *   'order', orderId, 'order.confirmed', 'order-queue',
 *   { orderId, amount },
 *   { critical: true, manager: transactionManager }
 * );
 *
 * // Non-critical: direct SQS (faster, DLQ backup)
 * await this.sideEffectService.createSqsSideEffect(
 *   'analytics', eventId, 'page.viewed', 'analytics-queue',
 *   { page, userId },
 *   { critical: false }
 * );
 * ```
 */
@Injectable()
export class SideEffectService {
    private static readonly OUTBOX_QUEUE_NAME = 'outbox-processor';

    constructor(
        @InjectRepository(SideEffectOutboxEntity)
        private readonly outboxRepository: Repository<SideEffectOutboxEntity>,
        private readonly tenantContext: ClsTenantContextService,
        private readonly logger: AppLoggerService,
        private readonly sqsProducer: SqsProducerService,
        private readonly snsPublisher: SnsPublisherService,
        @Optional()
        @Inject(BULLJOBS_SERVICE)
        private readonly bullJobsService?: BullJobsService,
    ) {
        this.logger.setContext(SideEffectService.name);
    }

    /**
     * Create a side effect (generic method)
     * Use convenience methods (createSqsSideEffect, createSnsSideEffect) for type safety
     */
    async createSideEffect(
        dto: ICreateSideEffectDto,
        options: ISideEffectOptions = {},
    ): Promise<SideEffectOutboxEntity | { messageId: string; direct: true }> {
        const { critical = true, manager } = options;

        if (critical) {
            return this.createOutboxSideEffect(dto, manager, options);
        }

        // Direct delivery - no outbox
        return this.sendDirectSideEffect(dto, options);
    }

    /**
     * Create side effect in outbox (guaranteed delivery)
     */
    private async createOutboxSideEffect(
        dto: ICreateSideEffectDto,
        manager?: EntityManager,
        options: ISideEffectOptions = {},
    ): Promise<SideEffectOutboxEntity> {
        const tenantId = this.tenantContext.getTenantId();
        const correlationId = this.tenantContext.getCorrelationId();

        // Generate idempotency key if not provided
        const idempotencyKey =
            options.idempotencyKey ||
            dto.idempotencyKey ||
            `${dto.aggregateType}:${dto.aggregateId}:${dto.eventType}:${ulid()}`;

        // Build entity
        const sideEffect = (manager?.getRepository(SideEffectOutboxEntity) || this.outboxRepository).create({
            tenantId,
            effectType: dto.effectType,
            aggregateType: dto.aggregateType,
            aggregateId: dto.aggregateId,
            eventType: dto.eventType,
            payload: dto.payload,
            metadata: {
                ...dto.metadata,
                ...options.metadata,
                correlationId,
            },
            scheduledAt: options.scheduledAt || dto.scheduledAt || new Date(),
            maxRetries: options.maxRetries ?? dto.maxRetries ?? 3,
            idempotencyKey,
            status: 'pending',
            retryCount: 0,
        });

        // Save using the provided manager (for transactions) or default repository
        const saved = await (manager?.getRepository(SideEffectOutboxEntity) || this.outboxRepository).save(
            sideEffect,
        );

        this.logger.log(
            `Created critical side effect: ${saved.id} [${dto.effectType}] for ${dto.aggregateType}:${dto.aggregateId}`,
        );

        // Enqueue job to BullMQ for processing
        await this.enqueueJob(saved, options.scheduledAt);

        return saved;
    }

    /**
     * Send side effect directly to SQS/SNS (no outbox)
     */
    private async sendDirectSideEffect(
        dto: ICreateSideEffectDto,
        options: ISideEffectOptions = {},
    ): Promise<{ messageId: string; direct: true }> {
        const publishOptions: IPublishOptions = {
            idempotencyKey: options.idempotencyKey || dto.idempotencyKey,
            messageGroupId: options.messageGroupId || this.tenantContext.getTenantId(),
            delaySeconds: options.delaySeconds,
        };

        let messageId: string;

        switch (dto.effectType) {
            case 'sqs': {
                const payload = dto.payload as ISqsSideEffectPayload;
                messageId = await this.sqsProducer.send(
                    payload.queueName,
                    payload.eventType,
                    payload.message,
                    publishOptions,
                );
                break;
            }
            case 'sns': {
                const payload = dto.payload as ISnsSideEffectPayload;
                messageId = await this.snsPublisher.publish(
                    payload.topicName,
                    payload.eventType,
                    payload.message,
                    publishOptions,
                );
                break;
            }
            case 'email':
            case 'audit':
                // Email and audit always require outbox pattern
                throw new Error(`Direct delivery not supported for effect type: ${dto.effectType}. Use critical=true.`);
            default:
                throw new Error(`Unknown effect type: ${dto.effectType}`);
        }

        this.logger.log(
            `Sent direct side effect [${dto.effectType}] for ${dto.aggregateType}:${dto.aggregateId} - messageId: ${messageId}`,
        );

        return { messageId, direct: true };
    }

    /**
     * Enqueue a side effect for processing via BullMQ
     */
    private async enqueueJob(sideEffect: SideEffectOutboxEntity, scheduledAt?: Date): Promise<void> {
        if (!this.bullJobsService) {
            this.logger.debug('BullJobs service not available, side effect will be processed by cron fallback');
            return;
        }

        try {
            const jobData: IOutboxJobData = {
                sideEffectId: sideEffect.id,
                effectType: sideEffect.effectType,
                aggregateType: sideEffect.aggregateType,
                aggregateId: sideEffect.aggregateId,
                eventType: sideEffect.eventType,
                tenantId: sideEffect.tenantId,
                correlationId: this.tenantContext.getCorrelationId(),
                userId: this.tenantContext.getUserId(),
            };

            // Calculate delay if scheduled for the future
            const delay = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0;

            await this.bullJobsService.addJob(
                SideEffectService.OUTBOX_QUEUE_NAME,
                `process-${sideEffect.effectType}`,
                jobData,
                {
                    jobId: sideEffect.id,
                    delay,
                    attempts: sideEffect.maxRetries,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                    removeOnComplete: 100,
                    removeOnFail: 500,
                },
            );

            this.logger.debug(`Enqueued side effect job: ${sideEffect.id}`, { delay });
        } catch (error) {
            this.logger.warn(
                `Failed to enqueue side effect job: ${sideEffect.id}`,
                { error: error instanceof Error ? error.message : 'Unknown' },
            );
        }
    }

    /**
     * Create multiple side effects at once
     */
    async createSideEffects(
        dtos: Array<ICreateSideEffectDto & { options?: ISideEffectOptions }>,
    ): Promise<Array<SideEffectOutboxEntity | { messageId: string; direct: true }>> {
        return Promise.all(
            dtos.map((item) => this.createSideEffect(item, item.options)),
        );
    }

    /**
     * Convenience method: Create SQS side effect
     *
     * @param aggregateType - Domain entity type (e.g., 'order', 'campaign')
     * @param aggregateId - Entity ID
     * @param eventType - Event type (e.g., 'order.created')
     * @param queueName - Target SQS queue name
     * @param message - Message payload to send
     * @param options - Delivery options (critical, manager, etc.)
     *
     * @example
     * ```typescript
     * // Critical (outbox) - use for important business events
     * await this.sideEffectService.createSqsSideEffect(
     *   'order', orderId, 'order.confirmed', 'order-queue',
     *   { orderId, amount, customerId },
     *   { critical: true, manager: txManager }
     * );
     *
     * // Non-critical (direct) - use for analytics, metrics
     * await this.sideEffectService.createSqsSideEffect(
     *   'analytics', eventId, 'page.viewed', 'analytics-queue',
     *   { page, sessionId },
     *   { critical: false }
     * );
     * ```
     */
    async createSqsSideEffect<T = Record<string, unknown>>(
        aggregateType: string,
        aggregateId: string,
        eventType: EventType,
        queueName: SqsQueueName,
        message: T,
        options: ISideEffectOptions = {},
    ): Promise<SideEffectOutboxEntity | { messageId: string; direct: true }> {
        const payload: ISqsSideEffectPayload<T> = {
            queueName,
            eventType,
            message,
        };

        return this.createSideEffect(
            {
                effectType: 'sqs',
                aggregateType,
                aggregateId,
                eventType,
                payload,
            },
            options,
        );
    }

    /**
     * Convenience method: Create SNS side effect
     *
     * @param aggregateType - Domain entity type (e.g., 'campaign', 'user')
     * @param aggregateId - Entity ID
     * @param eventType - Event type (e.g., 'campaign.activated')
     * @param topicName - Target SNS topic name
     * @param message - Message payload to publish
     * @param options - Delivery options (critical, manager, etc.)
     *
     * @example
     * ```typescript
     * // Critical (outbox) - cross-service notifications
     * await this.sideEffectService.createSnsSideEffect(
     *   'campaign', campaignId, 'campaign.activated', 'campaign-events-topic',
     *   { campaignId, tenantId },
     *   { critical: true }
     * );
     *
     * // Non-critical (direct) - real-time updates
     * await this.sideEffectService.createSnsSideEffect(
     *   'user', oderId, 'user.online', 'user-events-topic',
     *   { oderId, status: 'online' },
     *   { critical: false }
     * );
     * ```
     */
    async createSnsSideEffect<T = Record<string, unknown>>(
        aggregateType: string,
        aggregateId: string,
        eventType: EventType,
        topicName: SnsTopicName,
        message: T,
        options: ISideEffectOptions = {},
    ): Promise<SideEffectOutboxEntity | { messageId: string; direct: true }> {
        const payload: ISnsSideEffectPayload<T> = {
            topicName,
            eventType,
            message,
        };

        return this.createSideEffect(
            {
                effectType: 'sns',
                aggregateType,
                aggregateId,
                eventType,
                payload,
            },
            options,
        );
    }

    /**
     * Convenience method: Create email side effect
     * Note: Email side effects always use outbox pattern (critical=true enforced)
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
        options: Omit<ISideEffectOptions, 'critical'> = {},
    ): Promise<SideEffectOutboxEntity> {
        const payload: IEmailSideEffectPayload = {
            to,
            subject,
            body,
            ...emailOptions,
        };

        const result = await this.createSideEffect(
            {
                effectType: 'email',
                aggregateType,
                aggregateId,
                eventType,
                payload,
            },
            { ...options, critical: true }, // Always critical
        );

        return result as SideEffectOutboxEntity;
    }

    /**
     * Convenience method: Create audit log side effect
     * Note: Audit side effects always use outbox pattern (critical=true enforced)
     */
    async createAuditSideEffect(
        aggregateType: string,
        aggregateId: string,
        eventType: string,
        action: string,
        changes: Record<string, unknown>,
        userId?: string,
        options: Omit<ISideEffectOptions, 'critical'> = {},
    ): Promise<SideEffectOutboxEntity> {
        const payload: IAuditSideEffectPayload = {
            action,
            changes,
            userId,
            timestamp: new Date().toISOString(),
        };

        const result = await this.createSideEffect(
            {
                effectType: 'audit',
                aggregateType,
                aggregateId,
                eventType,
                payload,
            },
            { ...options, critical: true }, // Always critical
        );

        return result as SideEffectOutboxEntity;
    }

    /**
     * Find all side effects for a specific aggregate
     */
    async findByAggregate(
        aggregateType: string,
        aggregateId: string,
    ): Promise<SideEffectOutboxEntity[]> {
        return this.outboxRepository.find({
            where: {
                aggregateType,
                aggregateId,
                tenantId: this.tenantContext.getTenantId(),
            },
            order: {
                createdAt: 'DESC',
            },
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
            this.outboxRepository.count({ where: { tenantId, status: 'pending' } }),
            this.outboxRepository.count({ where: { tenantId, status: 'processing' } }),
            this.outboxRepository.count({ where: { tenantId, status: 'completed' } }),
            this.outboxRepository.count({ where: { tenantId, status: 'failed' } }),
        ]);

        return { pending, processing, completed, failed };
    }
}
