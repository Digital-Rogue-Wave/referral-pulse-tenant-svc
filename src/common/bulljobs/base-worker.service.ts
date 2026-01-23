import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job, UnrecoverableError } from 'bullmq';
import type { AllConfigType } from '@app/config/config.type';
import type { IBaseJobData, IJobResult, IWorkerConfig } from '@app/types';
import { BullJobsConnectionFactory } from './bulljobs-connection.factory';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { MetricsService } from '@app/common/monitoring/metrics.service';
import { TracingService } from '@app/common/monitoring/tracing.module';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { DateService } from '@app/common/helper/date.service';

/**
 * Base worker class for processing BullMQ jobs
 * Extends this class to create specific job processors
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class EmailWorkerService extends BaseWorkerService<IEmailJobData> {
 *   constructor(...deps) {
 *     super('email-queue', deps);
 *   }
 *
 *   protected async processJob(job: Job<IEmailJobData>): Promise<IJobResult> {
 *     // Your job processing logic here
 *     await this.sendEmail(job.data);
 *     return { success: true };
 *   }
 * }
 * ```
 */
export abstract class BaseWorkerService<T extends IBaseJobData = IBaseJobData>
    implements OnModuleInit, OnModuleDestroy
{
    protected worker: Worker<T, IJobResult>;
    protected readonly queueName: string;

    constructor(
        queueName: string,
        protected readonly connectionFactory: BullJobsConnectionFactory,
        protected readonly configService: ConfigService<AllConfigType>,
        protected readonly logger: AppLoggerService,
        protected readonly metricsService: MetricsService,
        protected readonly tracingService: TracingService,
        protected readonly tenantContext: ClsTenantContextService,
        protected readonly dateService: DateService,
    ) {
        this.queueName = queueName;
        this.logger.setContext(`${this.constructor.name}`);
    }

    async onModuleInit(): Promise<void> {
        const connection = this.connectionFactory.createConnectionOptions();
        const prefix = this.connectionFactory.getKeyPrefix();
        const workerConfig = this.getWorkerConfig();

        this.worker = new Worker<T, IJobResult>(
            this.queueName,
            async (job: Job<T>) => this.handleJob(job),
            {
                ...workerConfig,
                connection,
                prefix,
            },
        );

        this.setupEventHandlers();
        this.logger.log(`✅ Worker initialized for queue: ${this.queueName}`);
    }

    async onModuleDestroy(): Promise<void> {
        await this.worker?.close();
        this.logger.log(`Worker closed for queue: ${this.queueName}`);
    }

    /**
     * Main job processing logic - must be implemented by child classes
     */
    protected abstract processJob(job: Job<T>): Promise<IJobResult>;

    /**
     * Get worker configuration - can be overridden by child classes
     */
    protected getWorkerConfig(): IWorkerConfig {
        return {
            concurrency: 5, // Process 5 jobs concurrently per worker
            limiter: {
                max: 10, // Max 10 jobs
                duration: 1000, // Per second
            },
        };
    }

    /**
     * Handle job execution with tracing and tenant context
     */
    private async handleJob(job: Job<T>): Promise<IJobResult> {
        const startTime = this.dateService.now();

        // Tenant context is set automatically by the CLS module
        // based on the incoming job data

        this.logger.debug(`🔄 Processing job ${job.id} from queue ${this.queueName}`, {
            jobId: job.id,
            queueName: this.queueName,
            attemptNumber: job.attemptsMade + 1,
            tenantId: job.data.tenantId,
        });

        try {
            const result = await this.processJob(job);
            const processingTime = this.dateService.now() - startTime;

            this.logger.log(`✅ Job ${job.id} completed successfully`, {
                jobId: job.id,
                queueName: this.queueName,
                processingTime,
            });

            this.metricsService.recordQueueJobProcessed(this.queueName, true, processingTime);

            return {
                ...result,
                processingTime,
                attemptNumber: job.attemptsMade + 1,
            };
        } catch (error) {
            const processingTime = this.dateService.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            this.logger.error(`❌ Job ${job.id} failed: ${errorMessage}`, error instanceof Error ? error.stack : undefined, {
                jobId: job.id,
                queueName: this.queueName,
                attemptNumber: job.attemptsMade + 1,
                error: errorMessage,
            });

            this.metricsService.recordQueueJobProcessed(this.queueName, false, processingTime);

            // Throw UnrecoverableError to prevent retries for certain errors
            if (this.isUnrecoverableError(error)) {
                throw new UnrecoverableError(errorMessage);
            }

            throw error;
        }
    }

    /**
     * Determine if an error is unrecoverable (no retries)
     * Override this method to customize retry logic
     */
    protected isUnrecoverableError(error: unknown): boolean {
        if (error instanceof Error) {
            // Common unrecoverable errors
            const unrecoverableMessages = [
                'validation error',
                'invalid data',
                'unauthorized',
                'forbidden',
                'not found',
            ];
            return unrecoverableMessages.some((msg) => error.message.toLowerCase().includes(msg));
        }
        return false;
    }

    /**
     * Setup event handlers for worker events
     */
    private setupEventHandlers(): void {
        this.worker.on('completed', (job: Job<T, IJobResult>) => {
            this.logger.debug(`✅ Job ${job.id} completed`, {
                jobId: job.id,
                queueName: this.queueName,
                returnValue: job.returnvalue,
            });
        });

        this.worker.on('failed', (job: Job<T> | undefined, error: Error) => {
            this.logger.error(`❌ Job ${job?.id || 'unknown'} failed`, error.stack, {
                jobId: job?.id,
                queueName: this.queueName,
                error: error.message,
                attemptsMade: job?.attemptsMade,
            });
        });

        this.worker.on('stalled', (jobId: string) => {
            this.logger.warn(`⚠️ Job ${jobId} stalled`, {
                jobId,
                queueName: this.queueName,
            });
        });

        this.worker.on('progress', (job: Job<T>, progress: number | object) => {
            this.logger.debug(`📊 Job ${job.id} progress: ${JSON.stringify(progress)}`, {
                jobId: job.id,
                queueName: this.queueName,
                progress,
            });
        });

        this.worker.on('error', (error: Error) => {
            this.logger.error(`❌ Worker error in queue ${this.queueName}`, error.stack, {
                queueName: this.queueName,
                error: error.message,
            });
        });
    }

    /**
     * Pause the worker
     */
    async pause(): Promise<void> {
        await this.worker.pause();
        this.logger.log(`⏸️ Worker paused for queue: ${this.queueName}`);
    }

    /**
     * Resume the worker
     */
    async resume(): Promise<void> {
        await this.worker.resume();
        this.logger.log(`▶️ Worker resumed for queue: ${this.queueName}`);
    }

    /**
     * Check if worker is running
     */
    isRunning(): boolean {
        return this.worker.isRunning();
    }

    /**
     * Check if worker is paused
     */
    isPaused(): boolean {
        return this.worker.isPaused();
    }
}