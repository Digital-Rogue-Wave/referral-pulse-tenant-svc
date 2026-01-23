import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue, Job, JobState } from 'bullmq';
import type { IBaseJobData, IJobOptions, IQueueMetrics } from '@app/types';
import { BullJobsConnectionFactory } from './bulljobs-connection.factory';
import { AppLoggerService } from '@app/common/logging/app-logger.service';
import { TracingService } from '@app/common/monitoring/tracing.module';
import { ClsTenantContextService } from '@app/common/tenant/cls-tenant-context.service';
import { DateService } from '@app/common/helper/date.service';

/**
 * Service for managing BullMQ queues and jobs
 * Use this service to add jobs to queues, get job status, and manage queues
 */
@Injectable()
export class BullJobsService implements OnModuleDestroy {
    private queues: Map<string, Queue> = new Map();

    constructor(
        private readonly connectionFactory: BullJobsConnectionFactory,
        private readonly logger: AppLoggerService,
        private readonly tracingService: TracingService,
        private readonly tenantContext: ClsTenantContextService,
        private readonly dateService: DateService,
    ) {
        this.logger.setContext(BullJobsService.name);
    }

    async onModuleDestroy(): Promise<void> {
        // Close all queues
        for (const [name, queue] of this.queues.entries()) {
            await queue.close();
            this.logger.log(`Queue ${name} closed`);
        }
        this.queues.clear();
    }

    /**
     * Get or create a queue instance
     */
    private getQueue<T extends IBaseJobData = IBaseJobData>(queueName: string): Queue<T> {
        if (!this.queues.has(queueName)) {
            const connection = this.connectionFactory.createConnectionOptions();
            const prefix = this.connectionFactory.getKeyPrefix();

            const queue = new Queue<T>(queueName, {
                connection,
                prefix,
                defaultJobOptions: this.getDefaultJobOptions(),
            });

            this.queues.set(queueName, queue);
            this.logger.log(`✅ Queue created: ${queueName}`);
        }

        return this.queues.get(queueName) as Queue<T>;
    }

    /**
     * Get default job options
     */
    private getDefaultJobOptions(): IJobOptions {
        return {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000, // Start with 1 second
            },
            removeOnComplete: 100, // Keep last 100 completed jobs
            removeOnFail: 500, // Keep last 500 failed jobs for debugging
        };
    }

    /**
     * Add a job to a queue with tenant context
     */
    async addJob<T extends IBaseJobData>(
        queueName: string,
        jobName: string,
        data: T,
        options?: IJobOptions,
    ): Promise<Job<T>> {
        const queue = this.getQueue<T>(queueName);

        // Enrich job data with tenant context
        const enrichedData: T = {
            ...data,
            tenantId: data.tenantId || this.tenantContext.getTenantId(),
            userId: data.userId || this.tenantContext.getUserId(),
            correlationId: data.correlationId || this.tenantContext.getCorrelationId(),
            traceId: data.traceId || this.tenantContext.getTraceId(),
            spanId: data.spanId || this.tenantContext.getSpanId(),
        };

        const job = await queue.add(jobName as any, enrichedData as any, {
            ...this.getDefaultJobOptions(),
            ...options,
        });

        this.logger.debug(`✅ Job added to queue ${queueName}`, {
            queueName,
            jobName,
            jobId: job.id,
            tenantId: enrichedData.tenantId,
        });

        return job;
    }

    /**
     * Add multiple jobs in bulk (more efficient)
     */
    async addBulk<T extends IBaseJobData>(
        queueName: string,
        jobs: Array<{ name: string; data: T; options?: IJobOptions }>,
    ): Promise<Job<T>[]> {
        const queue = this.getQueue<T>(queueName);

        const enrichedJobs = jobs.map((job) => ({
            name: job.name as any,
            data: {
                ...job.data,
                tenantId: job.data.tenantId || this.tenantContext.getTenantId(),
                userId: job.data.userId || this.tenantContext.getUserId(),
                correlationId: job.data.correlationId || this.tenantContext.getCorrelationId(),
            } as T,
            opts: {
                ...this.getDefaultJobOptions(),
                ...job.options,
            },
        }));

        const addedJobs = await queue.addBulk(enrichedJobs as any);

        this.logger.log(`✅ Added ${jobs.length} jobs to queue ${queueName}`, {
            queueName,
            count: jobs.length,
        });

        return addedJobs;
    }

    /**
     * Add a delayed job (scheduled for future execution)
     */
    async addDelayedJob<T extends IBaseJobData>(
        queueName: string,
        jobName: string,
        data: T,
        delayMs: number,
        options?: IJobOptions,
    ): Promise<Job<T>> {
        return this.addJob(queueName, jobName, data, {
            ...options,
            delay: delayMs,
        });
    }

    /**
     * Add a recurring job (cron-like)
     */
    async addRepeatingJob<T extends IBaseJobData>(
        queueName: string,
        jobName: string,
        data: T,
        repeatOptions: {
            pattern?: string; // Cron pattern
            every?: number; // Repeat every X milliseconds
            limit?: number; // Max number of times to repeat
        },
        options?: IJobOptions,
    ): Promise<Job<T>> {
        return this.addJob(queueName, jobName, data, {
            ...options,
            repeat: repeatOptions,
        });
    }

    /**
     * Get a job by ID
     */
    async getJob<T extends IBaseJobData = IBaseJobData>(queueName: string, jobId: string): Promise<Job<T> | undefined> {
        const queue = this.getQueue<T>(queueName);
        return queue.getJob(jobId);
    }

    /**
     * Get job state
     */
    async getJobState(queueName: string, jobId: string): Promise<JobState | 'unknown'> {
        const job = await this.getJob(queueName, jobId);
        if (!job) return 'unknown';
        return job.getState();
    }

    /**
     * Remove a job
     */
    async removeJob(queueName: string, jobId: string): Promise<void> {
        const job = await this.getJob(queueName, jobId);
        if (job) {
            await job.remove();
            this.logger.debug(`Job ${jobId} removed from queue ${queueName}`);
        }
    }

    /**
     * Retry a failed job
     */
    async retryJob(queueName: string, jobId: string): Promise<void> {
        const job = await this.getJob(queueName, jobId);
        if (job) {
            await job.retry();
            this.logger.log(`Job ${jobId} retried in queue ${queueName}`);
        }
    }

    /**
     * Get queue metrics
     */
    async getQueueMetrics(queueName: string): Promise<IQueueMetrics> {
        const queue = this.getQueue(queueName);
        const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
            'paused',
        );

        return {
            waiting: counts.waiting || 0,
            active: counts.active || 0,
            completed: counts.completed || 0,
            failed: counts.failed || 0,
            delayed: counts.delayed || 0,
            paused: counts.paused || 0,
        };
    }

    /**
     * Get failed jobs
     */
    async getFailedJobs<T extends IBaseJobData = IBaseJobData>(
        queueName: string,
        start = 0,
        end = 10,
    ): Promise<Job<T>[]> {
        const queue = this.getQueue<T>(queueName);
        return queue.getFailed(start, end);
    }

    /**
     * Get completed jobs
     */
    async getCompletedJobs<T extends IBaseJobData = IBaseJobData>(
        queueName: string,
        start = 0,
        end = 10,
    ): Promise<Job<T>[]> {
        const queue = this.getQueue<T>(queueName);
        return queue.getCompleted(start, end);
    }

    /**
     * Get waiting jobs
     */
    async getWaitingJobs<T extends IBaseJobData = IBaseJobData>(
        queueName: string,
        start = 0,
        end = 10,
    ): Promise<Job<T>[]> {
        const queue = this.getQueue<T>(queueName);
        return queue.getWaiting(start, end);
    }

    /**
     * Get active jobs
     */
    async getActiveJobs<T extends IBaseJobData = IBaseJobData>(
        queueName: string,
        start = 0,
        end = 10,
    ): Promise<Job<T>[]> {
        const queue = this.getQueue<T>(queueName);
        return queue.getActive(start, end);
    }

    /**
     * Clean old jobs from queue
     */
    async cleanQueue(
        queueName: string,
        grace: number = 3600000, // 1 hour in ms
        limit: number = 1000,
        type: 'completed' | 'failed' = 'completed',
    ): Promise<string[]> {
        const queue = this.getQueue(queueName);
        const cleaned = await queue.clean(grace, limit, type);

        this.logger.log(`🧹 Cleaned ${cleaned.length} ${type} jobs from queue ${queueName}`, {
            queueName,
            type,
            count: cleaned.length,
        });

        return cleaned;
    }

    /**
     * Pause queue (stop processing new jobs)
     */
    async pauseQueue(queueName: string): Promise<void> {
        const queue = this.getQueue(queueName);
        await queue.pause();
        this.logger.log(`⏸️ Queue paused: ${queueName}`);
    }

    /**
     * Resume queue
     */
    async resumeQueue(queueName: string): Promise<void> {
        const queue = this.getQueue(queueName);
        await queue.resume();
        this.logger.log(`▶️ Queue resumed: ${queueName}`);
    }

    /**
     * Empty queue (remove all jobs)
     */
    async emptyQueue(queueName: string): Promise<void> {
        const queue = this.getQueue(queueName);
        await queue.drain();
        this.logger.warn(`🗑️ Queue emptied: ${queueName}`);
    }

    /**
     * Get all registered queues
     */
    getRegisteredQueues(): string[] {
        return Array.from(this.queues.keys());
    }
}