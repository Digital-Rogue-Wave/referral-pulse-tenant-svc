import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AuditService } from './audit.service';
import { AUDIT_QUEUE, AUDIT_LOG_CLEANUP_JOB } from '@mod/common/bullmq/queues/audit.queue';
import dayjs from 'dayjs';

@Processor(AUDIT_QUEUE)
@Injectable()
export class AuditProcessor extends WorkerHost {
    private readonly logger = new Logger(AuditProcessor.name);

    constructor(private readonly auditService: AuditService) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        switch (job.name) {
            case AUDIT_LOG_CLEANUP_JOB:
                return await this.handleCleanup();
            default:
                this.logger.warn(`Unknown job name: ${job.name}`);
        }
    }

    private async handleCleanup() {
        this.logger.log('Running audit log cleanup...');

        // Retention period: 90 days (could be configurable)
        const retentionDays = 90;
        const cutoffDate = dayjs().subtract(retentionDays, 'day').toDate();

        const deletedCount = await this.auditService.deleteOlderThan(cutoffDate);

        this.logger.log(`Audit log cleanup completed. Deleted ${deletedCount} logs older than ${cutoffDate.toISOString()}.`);
        return { deletedCount };
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, error: Error) {
        this.logger.error(`Audit job ${job.id} failed: ${error.message}`, error.stack);
    }
}
