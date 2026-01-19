import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
    BILLING_USAGE_QUEUE,
    MONTHLY_USAGE_RESET_JOB,
    DAILY_USAGE_SNAPSHOT_JOB,
    PAYMENT_STATUS_ESCALATION_JOB,
    TRIAL_LIFECYCLE_JOB,
    PLAN_STRIPE_SYNC_JOB
} from '@mod/common/bullmq/queues/billing-usage.queue';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '@mod/config/config.type';

@Injectable()
export class BillingUsageQueueService implements OnModuleInit {
    private readonly logger = new Logger(BillingUsageQueueService.name);

    constructor(
        @InjectQueue(BILLING_USAGE_QUEUE) private readonly billingUsageQueue: Queue,
        private readonly configService: ConfigService<AllConfigType>
    ) {}

    async onModuleInit(): Promise<void> {
        await this.scheduleRepeatableJobs();
    }

    private async scheduleRepeatableJobs(): Promise<void> {
        this.logger.log('Scheduling repeatable jobs for billing usage queue...');

        const planSyncEnabled = this.configService.get('billingConfig.planStripeSyncEnabled', { infer: true });
        const planSyncCron = this.configService.get('billingConfig.planStripeSyncCron', { infer: true });

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

        await this.billingUsageQueue.add(
            PAYMENT_STATUS_ESCALATION_JOB,
            {},
            {
                repeat: {
                    pattern: '0 9 * * *'
                },
                jobId: PAYMENT_STATUS_ESCALATION_JOB
            }
        );

        await this.billingUsageQueue.add(
            TRIAL_LIFECYCLE_JOB,
            {},
            {
                repeat: {
                    pattern: '0 9 * * *'
                },
                jobId: TRIAL_LIFECYCLE_JOB
            }
        );

        if (planSyncEnabled) {
            await this.billingUsageQueue.add(
                PLAN_STRIPE_SYNC_JOB,
                {},
                {
                    repeat: {
                        pattern: planSyncCron
                    },
                    jobId: PLAN_STRIPE_SYNC_JOB
                }
            );
            this.logger.log(`Stripe plan sync job scheduled: ${PLAN_STRIPE_SYNC_JOB} (${planSyncCron})`);
        } else {
            this.logger.log(`Stripe plan sync job is disabled (billingConfig.planStripeSyncEnabled=false)`);
        }

        this.logger.log('Billing usage repeatable jobs scheduled.');
    }
}
