import { Global, Module } from '@nestjs/common';
import { BullJobsService } from './bulljobs.service';
import { BullJobsConnectionFactory } from './bulljobs-connection.factory';
import { RedisModule } from '@app/common/redis/redis.module';
import { LoggingModule } from '@app/common/logging/logging.module';

/**
 * Global BullMQ Jobs Module
 *
 * This module provides queue management capabilities using BullMQ.
 * It's configured as @Global() so it can be used throughout the application.
 *
 * Features:
 * - Job queue management with Redis backend
 * - Worker support for processing jobs in separate processes
 * - Automatic job retries with exponential backoff
 * - Job scheduling and delayed execution
 * - Tenant-aware job processing
 * - Integrated with application monitoring and tracing
 *
 * @example Basic Usage:
 * ```typescript
 * // In your service
 * constructor(private readonly bullJobsService: BullJobsService) {}
 *
 * // Add a job
 * await this.bullJobsService.addJob('email-queue', 'send-email', {
 *   to: 'user@example.com',
 *   subject: 'Welcome',
 *   body: 'Hello!',
 * });
 * ```
 *
 * @example Worker Usage:
 * ```typescript
 * // Create a worker service
 * @Injectable()
 * export class EmailWorkerService extends BaseWorkerService<IEmailJobData> {
 *   constructor(
 *     connectionFactory: BullJobsConnectionFactory,
 *     configService: ConfigService,
 *     logger: AppLoggerService,
 *     metricsService: MetricsService,
 *     tracingService: TracingService,
 *     tenantContext: ClsTenantContextService,
 *     dateService: DateService,
 *   ) {
 *     super('email-queue', connectionFactory, configService, logger, metricsService, tracingService, tenantContext, dateService);
 *   }
 *
 *   protected async processJob(job: Job<IEmailJobData>): Promise<IJobResult> {
 *     await this.sendEmail(job.data);
 *     return { success: true };
 *   }
 * }
 *
 * // Register in module
 * @Module({
 *   providers: [EmailWorkerService],
 * })
 * export class EmailModule {}
 * ```
 *
 * @example Scheduled Jobs:
 * ```typescript
 * // Add a delayed job (execute in 1 hour)
 * await this.bullJobsService.addDelayedJob(
 *   'notification-queue',
 *   'send-reminder',
 *   { userId: '123', message: 'Don\'t forget!' },
 *   60 * 60 * 1000, // 1 hour in milliseconds
 * );
 *
 * // Add a repeating job (every day at midnight)
 * await this.bullJobsService.addRepeatingJob(
 *   'report-queue',
 *   'daily-report',
 *   { reportType: 'daily' },
 *   { pattern: '0 0 * * *' }, // Cron expression
 * );
 * ```
 *
 * @example Monitoring:
 * ```typescript
 * // Get queue metrics
 * const metrics = await this.bullJobsService.getQueueMetrics('email-queue');
 * console.log(`Waiting: ${metrics.waiting}, Active: ${metrics.active}`);
 *
 * // Get failed jobs
 * const failedJobs = await this.bullJobsService.getFailedJobs('email-queue', 0, 10);
 *
 * // Retry a failed job
 * await this.bullJobsService.retryJob('email-queue', jobId);
 *
 * // Clean old completed jobs (older than 1 hour)
 * await this.bullJobsService.cleanQueue('email-queue', 3600000, 1000, 'completed');
 * ```
 */
@Global()
@Module({
    imports: [
        RedisModule,   // Required for BullJobsConnectionFactory to access RedisService
        LoggingModule, // Required for logging
    ],
    providers: [BullJobsService, BullJobsConnectionFactory],
    exports: [BullJobsService, BullJobsConnectionFactory],
})
export class BullJobsModule {}