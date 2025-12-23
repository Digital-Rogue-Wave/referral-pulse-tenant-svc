import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AUDIT_QUEUE, AUDIT_LOG_CLEANUP_JOB } from '@mod/common/bullmq/queues/audit.queue';

@Injectable()
export class AuditQueueService implements OnModuleInit {
    private readonly logger = new Logger(AuditQueueService.name);

    constructor(@InjectQueue(AUDIT_QUEUE) private readonly auditQueue: Queue) {}

    async onModuleInit() {
        await this.scheduleRepeatableJobs();
    }

    private async scheduleRepeatableJobs() {
        this.logger.log('Scheduling repeatable jobs for audit queue...');

        // Cleanup old logs daily at 2:00 AM
        await this.auditQueue.add(
            AUDIT_LOG_CLEANUP_JOB,
            {},
            {
                repeat: {
                    pattern: '0 2 * * *'
                },
                jobId: AUDIT_LOG_CLEANUP_JOB
            }
        );

        this.logger.log('Audit repeatable jobs scheduled.');
    }
}
