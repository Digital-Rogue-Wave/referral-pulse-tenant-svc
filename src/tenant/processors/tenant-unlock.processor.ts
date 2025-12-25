import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TENANT_UNLOCK_QUEUE, TenantUnlockJobData } from '@mod/common/bullmq/queues/tenant-unlock.queue';
import { AwareTenantService } from '../aware/aware-tenant.service';

@Processor(TENANT_UNLOCK_QUEUE)
export class TenantUnlockProcessor extends WorkerHost {
    private readonly logger = new Logger(TenantUnlockProcessor.name);

    constructor(private readonly tenantService: AwareTenantService) {
        super();
    }

    async process(job: Job<TenantUnlockJobData>): Promise<void> {
        const { tenantId, lockUntil } = job.data;

        this.logger.log(`Processing auto-unlock job for tenant ${tenantId}`);
        this.logger.log(`Locked until: ${lockUntil}`);

        try {
            await this.tenantService.autoUnlock(tenantId);
            this.logger.log(`Successfully unlocked tenant ${tenantId}`);
        } catch (error) {
            this.logger.error(`Failed to auto-unlock tenant ${tenantId}:`, error);
            throw error;
        }
    }
}
