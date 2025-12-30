import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { BILLING_USAGE_QUEUE, MONTHLY_USAGE_RESET_JOB, DAILY_USAGE_SNAPSHOT_JOB } from '@mod/common/bullmq/queues/billing-usage.queue';

@Injectable()
export class BillingUsageQueueService implements OnModuleInit {
    private readonly logger = new Logger(BillingUsageQueueService.name);

    constructor(@InjectQueue(BILLING_USAGE_QUEUE) private readonly billingUsageQueue: Queue) {}

    async onModuleInit(): Promise<void> {
        await this.scheduleRepeatableJobs();
    }

    private async scheduleRepeatableJobs(): Promise<void> {
        this.logger.log('Scheduling repeatable jobs for billing usage queue...');

        await this.billingUsageQueue.add(
            MONTHLY_USAGE_RESET_JOB,
            {},
            {
                repeat: {
                    pattern: '0 0 1 * *'
                },
                jobId: MONTHLY_USAGE_RESET_JOB
            }
        );

        await this.billingUsageQueue.add(
            DAILY_USAGE_SNAPSHOT_JOB,
            {},
            {
                repeat: {
                    pattern: '0 0 * * *'
                },
                jobId: DAILY_USAGE_SNAPSHOT_JOB
            }
        );

        this.logger.log('Billing usage repeatable jobs scheduled.');
    }
}
