import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingEntity } from './billing.entity';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { StripeService } from './stripe.service';
import { BillingListener } from './listeners/billing.listener';
import { TenantAwareRepositoryModule } from '@mod/common/tenant/tenant-aware.repository';
import { PlanEntity } from './plan.entity';
import { TenantUsageEntity } from './tenant-usage.entity';
import { BillingEventEntity } from './billing-event.entity';
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

@Module({
    imports: [
        TypeOrmModule.forFeature([PlanEntity]),
        TenantAwareRepositoryModule.forEntities([
            BillingEntity,
            TenantUsageEntity,
            BillingEventEntity
        ]),
        TenantModule
    ],
    controllers: [BillingController, PlanAdminController, PlanPublicController, TestBillingController],
    providers: [BillingService, StripeService, BillingListener, PlanService, PlanSerializationProfile, PlanStripeSyncService, PaymentRequiredGuard, UsageTrackerService, UsageCheckGuard],
    exports: [BillingService, PlanService, PaymentRequiredGuard, UsageTrackerService, UsageCheckGuard]
})
export class BillingModule {}
