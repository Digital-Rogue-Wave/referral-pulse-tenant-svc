import { Module } from '@nestjs/common';

import { PlanLimitService } from './plan-limit.service';
import { UsageCounterService } from './usage-counter.service';
import { UsageTrackerService } from './usage-tracker.service';

/**
 * Plan limits and usage counters. Depends on nothing but global infrastructure, so users, invitations and
 * API keys can enforce plan limits without importing BillingModule (which depends on TenantModule).
 */
@Module({
    providers: [UsageCounterService, PlanLimitService, UsageTrackerService],
    exports: [UsageCounterService, PlanLimitService, UsageTrackerService]
})
export class PlanLimitModule {}
