import { Controller, Get, Post, UseGuards, Req, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlanStripeSyncService } from './plan-stripe-sync.service';
import { BillingService } from './billing.service';
import { PlanService } from './plan.service';
import Stripe from 'stripe';
import { PlanLimitService } from './plan-limit.service';
import { BillingGuardConfig } from './decorators/billing-guard.decorator';
import { BillingGuard } from './guards/billing.guard';
import { Request } from 'express';

@ApiTags('Testing')
@Controller('test')
export class TestBillingController {
  constructor(
    private readonly planSyncService: PlanStripeSyncService,
    private readonly billingService: BillingService,
    private readonly planService: PlanService,  
    private readonly planLimitService: PlanLimitService
  ) {}

  @Get('health')
  health() {
    return { 
      status: 'ok', 
      port: 5001,
      time: new Date().toISOString() 
    };
  }

  @Post('sync-stripe')
  async syncStripe() {
    await this.planSyncService.syncFromStripe();
    return { message: 'Stripe plans synced!' };
  }

  @Get('check-plans')
  async checkPlans() {
    // Use planService to get plans
    const plans = await this.planService.getPublicPlansCached();
    return {
      count: plans.length,
      plans: plans.map(p => ({
        id: p.id,
        name: p.name,
        stripePriceId: p.stripePriceId,
        isActive: p.isActive
      }))
    };
  }

  @Post('trigger-webhook')
  async triggerWebhook() {
    return {
      instruction: 'Run this in terminal:',
      command: 'stripe trigger checkout.session.completed'
    };
  }

  @Get('check-billing')
  async checkBilling() {
    // We'll implement this differently
    return { 
      message: 'Use billing service methods instead',
      hint: 'The billing repository is tenant-aware and requires tenant context'
    };
  }

  @Post('test-stripe-connection')
  async testStripe() {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-11-17.clover'
    });
  
    const customers = await stripe.customers.list({ limit: 1 });
  
    return {
      connected: true,
      customerCount: customers.data.length,
      defaultCurrency: customers.data[0]?.currency || 'usd'
    };
  }

  // Simple endpoint to simulate checkout
  @Post('simulate-checkout')
  async simulateCheckout() {
    // This won't work without tenant context, but gives instructions
    return {
      steps: [
        '1. Get a valid JWT token',
        '2. Set tenant-id header',
        '3. POST to /api/v1/billings/subscription/checkout with {"plan": "starter"}',
        '4. Or test webhooks directly with: stripe trigger checkout.session.completed'
      ]
    };
  }

  @Get('remaining-capacity/:metric')
  async getRemainingCapacity(@Req() req: Request, @Param('metric') metric: string) {
    const tenantId =
      (req as any).tenantId ||
      (req.headers['tenant-id'] as string | undefined) ||
      (req.headers['tenantId'] as string | undefined);

    if (!tenantId) {
      return {
        error: 'TENANT_ID_REQUIRED',
        message: 'Provide tenant id via tenant-id header or set tenant context.',
      };
    }

    const remaining = await this.planLimitService.getRemainingCapacity(tenantId, metric);

    return {
      tenantId,
      metric,
      remaining,
    };
  }

  @Get('leaderboard-demo')
  async leaderboardDemo(@Req() req: Request) {
    const tenantId =
      (req as any).tenantId ||
      (req.headers['tenant-id'] as string | undefined) ||
      (req.headers['tenantId'] as string | undefined);

    const total = Number((req.query.total as string | undefined) ?? '50');

    if (!tenantId) {
      return {
        error: 'TENANT_ID_REQUIRED',
        message: 'Provide tenant id via tenant-id header or set tenant context.',
      };
    }

    const limits = await this.planLimitService.getPlanLimits(tenantId);
    const planLimit = limits?.leaderboard_entries ?? null;

    const effectiveLimit = planLimit ?? total;
    const shown = Math.min(total, effectiveLimit);

    const allEntries = Array.from({ length: total }, (_, i) => ({
      rank: i + 1,
      value: `entry-${i + 1}`,
    }));

    const visibleEntries = allEntries.slice(0, shown);

    return {
      tenantId,
      total,
      planLimit,
      shown,
      note: `Showing top ${shown} of ${total}${planLimit != null ? ` (plan limit ${planLimit})` : ''}`,
      entries: visibleEntries,
    };
  }

  @Post('limited-campaign')
  @UseGuards(BillingGuard)
  @BillingGuardConfig({
    metrics: ['campaigns'],
    amount: 1,
    gracePercentage: 10,
  })
  async limitedCampaignTest() {
    return {
      message: 'Test campaign allowed by BillingGuard based on plan limits',
      metric: 'campaigns',
      amount: 1,
      gracePercentage: 10,
    };
  }
}