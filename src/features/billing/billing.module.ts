import { Module } from '@nestjs/common';

import { TenantModule } from '@app/features/tenant/tenant.module';
import { EventsModule } from '@common/events/events.module';

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
import { StripeWebhookService } from './stripe-webhook.service';
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
import { UsageCheckGuard } from './guards/usage-check.guard';
import { BillingGuard } from './guards/billing.guard';

// Processors
import { BillingUsageProcessor } from './processors/billing-usage.processor';

/**
 * `TestBillingController` is dev scaffolding: ~24 routes under `/test/*` behind
 * bare JWT with no `@RequirePermission`, including usage increment/decrement,
 * subscription cancel/reactivate/upgrade/downgrade, manual plan seeding and
 * direct triggers for all four scheduled billing jobs. It was registered
 * unconditionally, so it shipped to production.
 *
 * Kept for local demos and manual testing. Registered only when ENABLE_TEST_ROUTES=true is set
 * explicitly — keying off NODE_ENV left them exposed on staging and any mis-set environment.
 * Module metadata is evaluated at import time, so this reads `process.env` directly rather than
 * ConfigService.
 */
const DEV_ONLY_CONTROLLERS = process.env.ENABLE_TEST_ROUTES === 'true' ? [TestBillingController] : [];

@Module({
    imports: [TenantModule, EventsModule],
    controllers: [
        BillingController,
        PlanAdminController,
        PlanPublicController,
        ...DEV_ONLY_CONTROLLERS,
        UsageInternalController,
        InternalTenantStatusController,
        StripeRedirectController
    ],
    providers: [
        BillingService,
        StripeService,
        StripeWebhookService,
        PlanService,
        PlanStripeSyncService,
        UsageTrackerService,
        UsageCheckGuard,
        PlanLimitService,
        BillingGuard,
        BillingUsageQueueService,
        BillingUsageProcessor,
        DailyUsageCalculator,
        MonthlyUsageResetService,
        PaymentStatusEscalationService,
        TrialLifecycleService
    ],
    exports: [
        BillingService,
        StripeWebhookService,
        PlanService,
        UsageTrackerService,
        UsageCheckGuard,
        PlanLimitService,
        BillingGuard,
        DailyUsageCalculator,
        MonthlyUsageResetService,
        PaymentStatusEscalationService,
        TrialLifecycleService
    ]
})
export class BillingModule {}
