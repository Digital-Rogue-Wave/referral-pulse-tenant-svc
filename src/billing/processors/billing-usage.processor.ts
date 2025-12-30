import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { BILLING_USAGE_QUEUE, MONTHLY_USAGE_RESET_JOB, DAILY_USAGE_SNAPSHOT_JOB } from '@mod/common/bullmq/queues/billing-usage.queue';
import { DailyUsageCalculator } from '../daily-usage-calculator.service';
import { MonthlyUsageResetService } from '../monthly-usage-reset.service';

@Processor(BILLING_USAGE_QUEUE)
export class BillingUsageProcessor extends WorkerHost {
    private readonly logger = new Logger(BillingUsageProcessor.name);

    constructor(
        private readonly dailyUsageCalculator: DailyUsageCalculator,
        private readonly monthlyUsageResetService: MonthlyUsageResetService
    ) {
        super();
    }

    async process(job: Job): Promise<void> {
        switch (job.name) {
            case MONTHLY_USAGE_RESET_JOB:
                await this.handleMonthlyReset();
                break;
            case DAILY_USAGE_SNAPSHOT_JOB:
                await this.handleDailyUsageSnapshot();
                break;
            default:
                this.logger.warn(`Unknown billing usage job name: ${job.name}`);
        }
    }

    private async handleMonthlyReset(): Promise<void> {
        this.logger.log('Running monthly usage reset job');
        await this.monthlyUsageResetService.runMonthlyReset();
    }

    private async handleDailyUsageSnapshot(): Promise<void> {
        this.logger.log('Running daily usage snapshot job');
        await this.dailyUsageCalculator.runDailySnapshot();
    }
}
