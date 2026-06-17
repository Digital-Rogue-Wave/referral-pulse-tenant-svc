import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
    BILLING_USAGE_QUEUE,
    MONTHLY_USAGE_RESET_JOB,
    DAILY_USAGE_SNAPSHOT_JOB,
    PAYMENT_STATUS_ESCALATION_JOB,
    TRIAL_LIFECYCLE_JOB,
    PLAN_STRIPE_SYNC_JOB
} from '@app/types';
import type { ISystemJobData } from '@app/types';

import { BullJobsService } from '@common/bulljobs';
import { AppLoggerService } from '@common/logging/app-logger.service';

import type { AllConfigType } from '@config/config.type';

const SYSTEM_JOB_DATA: ISystemJobData = { tenantId: 'system' };

@Injectable()
export class BillingUsageQueueService implements OnModuleInit {
    constructor(
        private readonly bullJobsService: BullJobsService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(BillingUsageQueueService.name);
    }

    async onModuleInit(): Promise<void> {
        const isWorker = this.configService.get<boolean>('app.isWorker', {
            infer: true
        });

        // Only schedule repeatable jobs if running in worker mode
        // or if explicitly enabled for web mode
        if (isWorker) {
            await this.scheduleRepeatableJobs();
        } else {
            this.logger.log('Skipping repeatable job scheduling (not in worker mode)');
        }
    }

    private async scheduleRepeatableJobs(): Promise<void> {
        this.logger.log('Scheduling repeatable jobs for billing usage queue...');

        const planSyncEnabled = this.configService.get('billingConfig.planStripeSyncEnabled', { infer: true });
        const planSyncCron =
            this.configService.get('billingConfig.planStripeSyncCron', {
                infer: true
            }) || '0 */6 * * *';

        // Monthly usage reset: 1st of each month at midnight
        await this.bullJobsService.addRepeatingJob(BILLING_USAGE_QUEUE, MONTHLY_USAGE_RESET_JOB, SYSTEM_JOB_DATA, {
            pattern: '0 0 1 * *'
        });

        // Daily usage snapshot: every day at midnight
        await this.bullJobsService.addRepeatingJob(BILLING_USAGE_QUEUE, DAILY_USAGE_SNAPSHOT_JOB, SYSTEM_JOB_DATA, {
            pattern: '0 0 * * *'
        });

        // Payment status escalation: every day at 9 AM
        await this.bullJobsService.addRepeatingJob(BILLING_USAGE_QUEUE, PAYMENT_STATUS_ESCALATION_JOB, SYSTEM_JOB_DATA, { pattern: '0 9 * * *' });

        // Trial lifecycle: every day at 9 AM
        await this.bullJobsService.addRepeatingJob(BILLING_USAGE_QUEUE, TRIAL_LIFECYCLE_JOB, SYSTEM_JOB_DATA, {
            pattern: '0 9 * * *'
        });

        if (planSyncEnabled) {
            await this.bullJobsService.addRepeatingJob(BILLING_USAGE_QUEUE, PLAN_STRIPE_SYNC_JOB, SYSTEM_JOB_DATA, {
                pattern: planSyncCron
            });
            this.logger.log(`Stripe plan sync job scheduled: ${PLAN_STRIPE_SYNC_JOB} (${planSyncCron})`);
        } else {
            this.logger.log('Stripe plan sync job is disabled (billingConfig.planStripeSyncEnabled=false)');
        }

        this.logger.log('Billing usage repeatable jobs scheduled.');
    }
}
