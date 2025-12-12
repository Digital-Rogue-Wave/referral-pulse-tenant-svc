import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TENANT_DELETION_QUEUE, TenantDeletionJobData } from '@mod/common/bullmq/queues/tenant-deletion.queue';
import { TenantService } from '@mod/tenant/tenant.service';

@Processor(TENANT_DELETION_QUEUE)
export class TenantDeletionProcessor extends WorkerHost {
    private readonly logger = new Logger(TenantDeletionProcessor.name);

    constructor(private readonly tenantService: TenantService) {
        super();
    }

    async process(job: Job<TenantDeletionJobData>): Promise<void> {
        const { tenantId, scheduledAt, executionDate, reason } = job.data;

        this.logger.log(`Processing tenant deletion job for tenant ${tenantId}`);
        this.logger.log(`Scheduled at: ${scheduledAt}, Execution date: ${executionDate}`);
        if (reason) {
            this.logger.log(`Reason: ${reason}`);
        }

        try {
            // Execute the tenant deletion
            await this.tenantService.executeDeletion(tenantId);

            this.logger.log(`Successfully deleted tenant ${tenantId}`);
        } catch (error) {
            this.logger.error(`Failed to delete tenant ${tenantId}:`, error);
            throw error; // Re-throw to mark job as failed
        }
    }
}
