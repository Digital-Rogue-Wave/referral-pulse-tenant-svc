import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
    BILLING_USAGE_QUEUE,
    MONTHLY_USAGE_RESET_JOB,
    DAILY_USAGE_SNAPSHOT_JOB,
    PAYMENT_STATUS_ESCALATION_JOB,
    TRIAL_LIFECYCLE_JOB,
    PLAN_STRIPE_SYNC_JOB
} from '@mod/common/bullmq/queues/billing-usage.queue';
import { DailyUsageCalculator } from '../daily-usage-calculator.service';
import { MonthlyUsageResetService } from '../monthly-usage-reset.service';
import { PaymentStatusEscalationService } from '../payment-status-escalation.service';
import { PlanStripeSyncService } from '../plan-stripe-sync.service';
import { TrialLifecycleService } from '../trial-lifecycle.service';

@Processor(BILLING_USAGE_QUEUE)
export class BillingUsageProcessor extends WorkerHost {
    private readonly logger = new Logger(BillingUsageProcessor.name);

    constructor(
        private readonly dailyUsageCalculator: DailyUsageCalculator,
        private readonly monthlyUsageResetService: MonthlyUsageResetService,
        private readonly paymentStatusEscalationService: PaymentStatusEscalationService,
        private readonly trialLifecycleService: TrialLifecycleService,
        private readonly planStripeSyncService: PlanStripeSyncService
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
            case PAYMENT_STATUS_ESCALATION_JOB:
                await this.handlePaymentStatusEscalation();
                break;
            case TRIAL_LIFECYCLE_JOB:
                await this.handleTrialLifecycle();
                break;
            case PLAN_STRIPE_SYNC_JOB:
                await this.handlePlanStripeSync();
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

    private async handlePaymentStatusEscalation(): Promise<void> {
        this.logger.log('Running payment status escalation job');
        await this.paymentStatusEscalationService.runEscalation();
    }

    private async handleTrialLifecycle(): Promise<void> {
        this.logger.log('Running trial lifecycle job');
        await this.trialLifecycleService.runDailyLifecycle();
    }

    private async handlePlanStripeSync(): Promise<void> {
        this.logger.log('Running Stripe plan sync job');
        await this.planStripeSyncService.syncFromStripe();
    }
}
