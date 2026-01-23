import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import type { AllConfigType } from '@app/config/config.type';
import type {
    IOutboxJobData,
    IJobResult,
    IWorkerConfig,
    ISqsSideEffectPayload,
    ISnsSideEffectPayload,
    IEmailSideEffectPayload,
    IAuditSideEffectPayload,
} from '@app/types';
import { BaseWorkerService, BullJobsConnectionFactory } from '@app/common/bulljobs';
import { SideEffectOutboxEntity } from './side-effect-outbox.entity';
import { SqsProducerService } from '@app/common/messaging/sqs-producer.service';
import { SnsPublisherService } from '@app/common/messaging/sns-publisher.service';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { MetricsService } from '@app/common/monitoring/metrics.service';
import { TracingService } from '@app/common/monitoring/tracing.module';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { DateService } from '@app/common/helper/date.service';

/**
 * BullMQ Worker for processing side effects from the outbox
 *
 * Benefits over cron-based approach:
 * - Distributed processing across multiple workers
 * - Built-in retry with exponential backoff
 * - Job persistence and recovery
 * - Better observability and metrics
 * - Rate limiting and concurrency control
 *
 * Queue name: 'outbox-processor'
 */
@Injectable()
export class OutboxWorkerService extends BaseWorkerService<IOutboxJobData> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: ClsTenantContextService,
        dateService: DateService,
        @InjectRepository(SideEffectOutboxEntity)
        private readonly outboxRepository: Repository<SideEffectOutboxEntity>,
        private readonly sqsProducer: SqsProducerService,
        private readonly snsPublisher: SnsPublisherService,
    ) {
        super(
            'outbox-processor',
            connectionFactory,
            configService,
            logger,
            metricsService,
            tracingService,
            tenantContext,
            dateService,
        );
    }

    /**
     * Configure worker for outbox processing
     */
    protected getWorkerConfig(): IWorkerConfig {
        return {
            concurrency: 10, // Process 10 side effects concurrently
            limiter: {
                max: 50, // Max 50 jobs per second
                duration: 1000,
            },
        };
    }

    /**
     * Process a single outbox side effect
     */
    protected async processJob(job: Job<IOutboxJobData>): Promise<IJobResult> {
        const { sideEffectId, effectType, aggregateType, aggregateId, eventType } = job.data;

        this.logger.debug(`Processing outbox side effect: ${sideEffectId}`, {
            sideEffectId,
            effectType,
            aggregateType,
            aggregateId,
            eventType,
        });

        // Fetch the side effect record
        const sideEffect = await this.outboxRepository.findOne({
            where: { id: sideEffectId },
        });

        if (!sideEffect) {
            this.logger.warn(`Side effect not found: ${sideEffectId}`);
            return { success: true, data: { skipped: true, reason: 'not_found' } };
        }

        // Skip if already completed
        if (sideEffect.status === 'completed') {
            this.logger.debug(`Side effect already completed: ${sideEffectId}`);
            return { success: true, data: { skipped: true, reason: 'already_completed' } };
        }

        // Mark as processing
        sideEffect.status = 'processing';
        await this.outboxRepository.save(sideEffect);

        try {
            // Execute based on effect type
            switch (sideEffect.effectType) {
                case 'sqs':
                    await this.processSqsEffect(sideEffect);
                    break;
                case 'sns':
                    await this.processSnsEffect(sideEffect);
                    break;
                case 'email':
                    await this.processEmailEffect(sideEffect);
                    break;
                case 'audit':
                    await this.processAuditEffect(sideEffect);
                    break;
                default:
                    throw new Error(`Unsupported effect type: ${sideEffect.effectType}`);
            }

            // Mark as completed
            sideEffect.status = 'completed';
            sideEffect.processedAt = new Date();
            await this.outboxRepository.save(sideEffect);

            this.logger.log(`Side effect completed: ${sideEffectId} [${effectType}]`);

            return { success: true };
        } catch (error) {
            // Update retry count and error
            sideEffect.retryCount++;
            sideEffect.lastError = error instanceof Error ? error.message : 'Unknown error';

            if (sideEffect.retryCount >= sideEffect.maxRetries) {
                sideEffect.status = 'failed';
                this.logger.error(
                    `Side effect failed permanently: ${sideEffectId}`,
                    error instanceof Error ? error.stack : undefined,
                );
            } else {
                sideEffect.status = 'pending';
                this.logger.warn(
                    `Side effect failed, will retry: ${sideEffectId} (${sideEffect.retryCount}/${sideEffect.maxRetries})`,
                );
            }

            await this.outboxRepository.save(sideEffect);
            throw error; // Let BullMQ handle retry
        }
    }

    /**
     * Process SQS side effect
     */
    private async processSqsEffect(sideEffect: SideEffectOutboxEntity): Promise<void> {
        const payload = sideEffect.payload as ISqsSideEffectPayload;
        const { queueName, eventType, message } = payload;

        if (!queueName || !eventType || !message) {
            throw new Error('Invalid SQS payload: missing queueName, eventType, or message');
        }

        await this.sqsProducer.send(queueName, eventType, message);

        this.logger.debug(`Sent SQS message to queue ${queueName} for side effect ${sideEffect.id}`);
    }

    /**
     * Process SNS side effect
     */
    private async processSnsEffect(sideEffect: SideEffectOutboxEntity): Promise<void> {
        const payload = sideEffect.payload as ISnsSideEffectPayload;
        const { topicName, eventType, message } = payload;

        if (!topicName || !eventType || !message) {
            throw new Error('Invalid SNS payload: missing topicName, eventType, or message');
        }

        await this.snsPublisher.publish(topicName, eventType, message);

        this.logger.debug(`Published SNS message to topic ${topicName} for side effect ${sideEffect.id}`);
    }

    /**
     * Process email side effect
     * NOTE: Implement actual email sending service (e.g., AWS SES, SendGrid)
     */
    private async processEmailEffect(sideEffect: SideEffectOutboxEntity): Promise<void> {
        const payload = sideEffect.payload as IEmailSideEffectPayload;
        const { to, subject, body } = payload;

        if (!to || !subject || !body) {
            throw new Error('Invalid email payload: missing to, subject, or body');
        }

        // TODO: Implement actual email service integration
        // await this.emailService.send({ to, subject, body, ...payload });

        this.logger.log(`[PLACEHOLDER] Would send email to ${to} with subject "${subject}"`);
    }

    /**
     * Process audit log side effect
     * NOTE: Implement actual audit logging service
     */
    private async processAuditEffect(sideEffect: SideEffectOutboxEntity): Promise<void> {
        const payload = sideEffect.payload as IAuditSideEffectPayload;
        const { action } = payload;

        if (!action) {
            throw new Error('Invalid audit payload: missing action');
        }

        // TODO: Implement actual audit logging service
        // await this.auditService.log({ ...payload, tenantId: sideEffect.tenantId });

        this.logger.log(
            `[PLACEHOLDER] Would create audit log for ${sideEffect.aggregateType}:${sideEffect.aggregateId} - action: ${action}`,
        );
    }

    /**
     * Check if error is unrecoverable (no retries)
     */
    protected isUnrecoverableError(error: unknown): boolean {
        if (error instanceof Error) {
            const unrecoverableMessages = [
                'invalid payload',
                'validation error',
                'missing required',
            ];
            return unrecoverableMessages.some((msg) => error.message.toLowerCase().includes(msg));
        }
        return false;
    }
}