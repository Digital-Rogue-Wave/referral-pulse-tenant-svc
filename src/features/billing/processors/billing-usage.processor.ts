import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';

import {
    BILLING_USAGE_QUEUE,
    MONTHLY_USAGE_RESET_JOB,
    DAILY_USAGE_SNAPSHOT_JOB,
    PAYMENT_STATUS_ESCALATION_JOB,
    TRIAL_LIFECYCLE_JOB,
    PLAN_STRIPE_SYNC_JOB,
} from '@app/types';
import type { IBillingJobData, IJobResult } from '@app/types';

import { BaseWorkerService, BullJobsConnectionFactory } from '@common/bulljobs';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MetricsService } from '@common/monitoring/metrics.service';
import { TracingService } from '@common/monitoring/tracing.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';

import type { AllConfigType } from '@config/config.type';

import { DailyUsageCalculator } from '../daily-usage-calculator.service';
import { MonthlyUsageResetService } from '../monthly-usage-reset.service';
import { PaymentStatusEscalationService } from '../payment-status-escalation.service';
import { PlanStripeSyncService } from '../plan-stripe-sync.service';
import { TrialLifecycleService } from '../trial-lifecycle.service';

@Injectable()
export class BillingUsageProcessor extends BaseWorkerService<IBillingJobData> {
    constructor(
        connectionFactory: BullJobsConnectionFactory,
        configService: ConfigService<AllConfigType>,
        logger: AppLoggerService,
        metricsService: MetricsService,
        tracingService: TracingService,
        tenantContext: TenantContextService,
        dateService: DateService,
        private readonly dailyUsageCalculator: DailyUsageCalculator,
        private readonly monthlyUsageResetService: MonthlyUsageResetService,
        private readonly paymentStatusEscalationService: PaymentStatusEscalationService,
        private readonly trialLifecycleService: TrialLifecycleService,
        private readonly planStripeSyncService: PlanStripeSyncService,
    ) {
        super(
            BILLING_USAGE_QUEUE,
            connectionFactory,
            configService,
            logger,
            metricsService,
            tracingService,
            tenantContext,
            dateService,
        );
    }

    protected async processJob(job: Job<IBillingJobData>): Promise<IJobResult> {
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
                return { success: false, error: `Unknown job name: ${job.name}` };
        }

        return { success: true };
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
