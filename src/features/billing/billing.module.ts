import { Module } from '@nestjs/common';

import { TenantModule } from '@app/features/tenant/tenant.module';

// Controllers
import { BillingController } from './billing.controller';
import { PlanAdminController } from './plan-admin.controller';
import { PlanPublicController } from './plan-public.controller';
import { TestBillingController } from './test-billing.controller';
import { UsageInternalController } from './usage-internal.controller';
import { InternalTenantStatusController } from './internal-tenant-status.controller';
import { StripeRedirectController } from './stripe-redirect.controller';

// Services
import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { PlanService } from './plan.service';
import { PlanStripeSyncService } from './plan-stripe-sync.service';
import { UsageTrackerService } from './usage-tracker.service';
import { PlanLimitService } from './plan-limit.service';
import { BillingUsageQueueService } from './billing-queue.service';
import { DailyUsageCalculator } from './daily-usage-calculator.service';
import { MonthlyUsageResetService } from './monthly-usage-reset.service';
import { PaymentStatusEscalationService } from './payment-status-escalation.service';
import { TrialLifecycleService } from './trial-lifecycle.service';

// Guards
import { PaymentRequiredGuard } from './guards/payment-required.guard';
import { UsageCheckGuard } from './guards/usage-check.guard';
import { BillingGuard } from './guards/billing.guard';

// Processors
import { BillingUsageProcessor } from './processors/billing-usage.processor';
import { ReferralEventProcessor } from './listeners/referral-events.consumer';

@Module({
    imports: [TenantModule],
    controllers: [
        BillingController,
        PlanAdminController,
        PlanPublicController,
        TestBillingController,
        UsageInternalController,
        InternalTenantStatusController,
        StripeRedirectController,
    ],
    providers: [
        BillingService,
        StripeService,
        PlanService,
        PlanStripeSyncService,
        PaymentRequiredGuard,
        UsageTrackerService,
        UsageCheckGuard,
        PlanLimitService,
        BillingGuard,
        BillingUsageQueueService,
        BillingUsageProcessor,
        DailyUsageCalculator,
        ReferralEventProcessor,
        MonthlyUsageResetService,
        PaymentStatusEscalationService,
        TrialLifecycleService,
    ],
    exports: [
        BillingService,
        PlanService,
        PaymentRequiredGuard,
        UsageTrackerService,
        UsageCheckGuard,
        PlanLimitService,
        BillingGuard,
        DailyUsageCalculator,
        ReferralEventProcessor,
        MonthlyUsageResetService,
        PaymentStatusEscalationService,
        TrialLifecycleService,
    ],
})
export class BillingModule {}
