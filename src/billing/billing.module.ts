import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { BillingEntity } from './billing.entity';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { StripeService } from './stripe.service';
import { BillingListener } from './listeners/billing.listener';
import { TenantAwareRepositoryModule } from '@mod/common/tenant/tenant-aware.repository';
import { PlanEntity } from './plan.entity';
import { TenantUsageEntity } from './tenant-usage.entity';
import { BillingEventEntity } from './billing-event.entity';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { PlanService } from './plan.service';
import { PlanAdminController } from './plan-admin.controller';
import { PlanPublicController } from './plan-public.controller';
import { PlanSerializationProfile } from './serialization/plan-serialization.profile';
import { PlanStripeSyncService } from './plan-stripe-sync.service';
import { TenantModule } from '@mod/tenant/tenant.module';
import { TestBillingController } from './test-billing.controller';
import { PaymentRequiredGuard } from './guards/payment-required.guard';
import { UsageTrackerService } from './usage-tracker.service';
import { UsageCheckGuard } from './guards/usage-check.guard';
import { PlanLimitService } from './plan-limit.service';
import { BillingGuard } from './guards/billing.guard';
import { UsageInternalController } from './usage-internal.controller';
import { BillingUsageQueueService } from './billing-queue.service';
import { BillingUsageProcessor } from './processors/billing-usage.processor';
import { BILLING_USAGE_QUEUE } from '@mod/common/bullmq/queues/billing-usage.queue';
import { RedisUsageService } from './redis-usage.service';
import { DailyUsageCalculator } from './daily-usage-calculator.service';
import { ReferralEventProcessor } from './listeners/referral-events.consumer';
import { MonthlyUsageResetService } from './monthly-usage-reset.service';
import { StripeRedirectController } from './stripe-redirect.controller';
import { InternalTenantStatusController } from './internal-tenant-status.controller';
import { PaymentStatusEscalationService } from './payment-status-escalation.service';
import { TrialLifecycleService } from './trial-lifecycle.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([PlanEntity, BillingEntity, TenantUsageEntity, BillingEventEntity, TenantEntity]),
        TenantAwareRepositoryModule.forEntities([BillingEntity, TenantUsageEntity, BillingEventEntity]),
        TenantModule,
        BullModule.registerQueue({ name: BILLING_USAGE_QUEUE })
    ],
    controllers: [
        BillingController,
        PlanAdminController,
        PlanPublicController,
        TestBillingController,
        UsageInternalController,
        InternalTenantStatusController,
        StripeRedirectController
    ],
    providers: [
        BillingService,
        StripeService,
        BillingListener,
        PlanService,
        PlanSerializationProfile,
        PlanStripeSyncService,
        PaymentRequiredGuard,
        UsageTrackerService,
        UsageCheckGuard,
        PlanLimitService,
        BillingGuard,
        BillingUsageQueueService,
        BillingUsageProcessor,
        RedisUsageService,
        DailyUsageCalculator,
        ReferralEventProcessor,
        MonthlyUsageResetService,
        PaymentStatusEscalationService,
        TrialLifecycleService
    ],
    exports: [
        BillingService,
        PlanService,
        PaymentRequiredGuard,
        UsageTrackerService,
        UsageCheckGuard,
        PlanLimitService,
        BillingGuard,
        RedisUsageService,
        DailyUsageCalculator,
        ReferralEventProcessor,
        MonthlyUsageResetService,
        PaymentStatusEscalationService,
        TrialLifecycleService
    ]
})
export class BillingModule {}
