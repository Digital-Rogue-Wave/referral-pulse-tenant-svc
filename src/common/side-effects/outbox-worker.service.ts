import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Job } from 'bullmq';
import { SideEffectOutbox as SideEffectOutboxModel } from '@prisma-gen/generated/client';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import type {
    IOutboxJobData,
    IJobResult,
    IWorkerConfig,
    ISqsSideEffectPayload,
    ISnsSideEffectPayload,
    IEmailSideEffectPayload,
    IAuditSideEffectPayload
} from '@app/types';

import { BaseWorkerService, BullJobsConnectionFactory } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { SnsPublisherService } from '@common/messaging/sns-publisher.service';
import { SqsProducerService } from '@common/messaging/sqs-producer.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';

import type { AllConfigType } from '@config/config.type';
import { DatabaseService } from '@app/database/database.service';

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
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly prisma: DatabaseService,
        private readonly sqsProducer: SqsProducerService,
        private readonly snsPublisher: SnsPublisherService
    ) {
        super('outbox-processor', connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
    }

    /**
     * Configure worker for outbox processing
     */
    protected getWorkerConfig(): IWorkerConfig {
        return {
            concurrency: 10, // Process 10 side effects concurrently
            limiter: {
                max: 50, // Max 50 jobs per second
                duration: 1000
            }
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
            eventType
        });

        // Fetch the side effect record
        const sideEffect = await this.prisma.sideEffectOutbox.findUnique({
            where: { id: sideEffectId }
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
        await this.prisma.sideEffectOutbox.update({
            where: { id: sideEffectId },
            data: { status: 'processing' }
        });

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
            await this.prisma.sideEffectOutbox.update({
                where: { id: sideEffectId },
                data: {
                    status: 'completed',
                    processedAt: new Date()
                }
            });

            this.logger.log(`Side effect completed: ${sideEffectId} [${effectType}]`);

            return { success: true };
        } catch (error) {
            // Update retry count and error
            const retryCount = (sideEffect.retryCount ?? 0) + 1;
            const maxRetries = sideEffect.maxRetries ?? 3;

            const status = retryCount >= maxRetries ? 'failed' : 'pending';
            const lastError = error instanceof Error ? error.message : 'Unknown error';

            if (status === 'failed') {
                this.logger.error(`Side effect failed permanently: ${sideEffectId}`, error instanceof Error ? error.stack : undefined);
            } else {
                this.logger.warn(`Side effect failed, will retry: ${sideEffectId} (${retryCount}/${maxRetries})`);
            }

            await this.prisma.sideEffectOutbox.update({
                where: { id: sideEffectId },
                data: {
                    status,
                    retryCount,
                    lastError
                }
            });

            throw error; // Let BullMQ handle retry
        }
    }

    /**
     * Process SQS side effect
     */
    private async processSqsEffect(sideEffect: SideEffectOutboxModel): Promise<void> {
        const payload = sideEffect.payload as unknown as ISqsSideEffectPayload;
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
    private async processSnsEffect(sideEffect: SideEffectOutboxModel): Promise<void> {
        const payload = sideEffect.payload as unknown as ISnsSideEffectPayload;
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
    private async processEmailEffect(sideEffect: SideEffectOutboxModel): Promise<void> {
        const payload = sideEffect.payload as unknown as IEmailSideEffectPayload;
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
    private async processAuditEffect(sideEffect: SideEffectOutboxModel): Promise<void> {
        const payload = sideEffect.payload as unknown as IAuditSideEffectPayload;
        const { action } = payload;

        if (!action) {
            throw new Error('Invalid audit payload: missing action');
        }

        // TODO: Implement actual audit logging service
        // await this.auditService.log({ ...payload, tenantId: sideEffect.tenantId });

        this.logger.log(`[PLACEHOLDER] Would create audit log for ${sideEffect.aggregateType}:${sideEffect.aggregateId} - action: ${action}`);
    }

    /**
     * Check if error is unrecoverable (no retries)
     */
    protected isUnrecoverableError(error: unknown): boolean {
        if (error instanceof Error) {
            const unrecoverableMessages = ['invalid payload', 'validation error', 'missing required'];
            return unrecoverableMessages.some((msg) => error.message.toLowerCase().includes(msg));
        }
        return false;
    }
}
