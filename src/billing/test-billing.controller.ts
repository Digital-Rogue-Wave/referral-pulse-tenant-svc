import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiTags } from '@nestjs/swagger';
import { PlanStripeSyncService } from './plan-stripe-sync.service';
import { BillingService } from './billing.service';
import { PlanService } from './plan.service';
import Stripe from 'stripe';
import { PlanLimitService } from './plan-limit.service';
import { BillingGuardConfig } from './decorators/billing-guard.decorator';
import { BillingGuard } from './guards/billing.guard';
import { Request } from 'express';
import { BillingPlanEnum } from '@mod/common/enums/billing.enum';
import { DailyUsageCalculator } from './daily-usage-calculator.service';
import { MonthlyUsageResetService } from './monthly-usage-reset.service';
import { ClsService } from 'nestjs-cls';
import { UsageTrackerService } from './usage-tracker.service';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingEntity } from './billing.entity';
import { BillingEventEntity } from './billing-event.entity';

@ApiTags('Testing')
@ApiBearerAuth()
@ApiHeader({ name: 'tenant-id', required: false })
@Controller('test')
export class TestBillingController {
  constructor(
    private readonly planSyncService: PlanStripeSyncService,
    private readonly billingService: BillingService,
    private readonly planService: PlanService,  
    private readonly planLimitService: PlanLimitService,
    private readonly dailyUsageCalculator: DailyUsageCalculator,
    private readonly monthlyUsageResetService: MonthlyUsageResetService,
    private readonly usageTracker: UsageTrackerService,
    private readonly cls: ClsService,
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
    @InjectRepository(BillingEntity)
    private readonly billingEntityRepository: Repository<BillingEntity>,
    @InjectRepository(BillingEventEntity)
    private readonly billingEventRepository: Repository<BillingEventEntity>
  ) {}

  @Post('stripe/checkout-session')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['plan'],
      properties: {
        plan: { type: 'string', enum: Object.values(BillingPlanEnum), example: Object.values(BillingPlanEnum)[0] },
        couponCode: { type: 'string', nullable: true, example: 'PROMO_CODE' }
      },
      additionalProperties: false
    }
  })
  async createRealStripeCheckoutSession(
    @Req() req: Request,
    @Body() body: { plan: BillingPlanEnum; couponCode?: string }
  ) {
    const tenantId = this.requireTenantId(req);

    const bodyObj = this.ensureObjectBody(body);
    this.ensurePlanId(bodyObj.plan);

    const result = await this.billingService.subscriptionCheckout(bodyObj.plan as BillingPlanEnum, bodyObj.couponCode);
    return {
      tenantId,
      ...result
    };
  }

  @Get('billing/subscription')
  async getBillingSubscription(@Req() req: Request) {
    const tenantId = this.requireTenantId(req);
    const status = await this.billingService.getCurrentSubscription();
    return { tenantId, ...status };
  }

  @Get('billing/usage')
  async getBillingUsage(@Req() req: Request) {
    const tenantId = this.requireTenantId(req);
    const usage = await this.billingService.getUsageSummary();
    return { tenantId, ...usage };
  }

  @Post('billing/upgrade')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['targetPlan'],
      properties: {
        targetPlan: { type: 'string', enum: Object.values(BillingPlanEnum), example: Object.values(BillingPlanEnum)[0] }
      },
      additionalProperties: false
    }
  })
  async upgradeSubscription(@Req() req: Request, @Body() body: { targetPlan: BillingPlanEnum }) {
    const tenantId = this.requireTenantId(req);
    const bodyObj = this.ensureObjectBody(body);
    this.ensurePlanId(bodyObj.targetPlan);
    const status = await this.billingService.upgradeSubscription(bodyObj.targetPlan as BillingPlanEnum);
    return { tenantId, ...status };
  }

  @Post('billing/downgrade')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['targetPlan'],
      properties: {
        targetPlan: { type: 'string', enum: Object.values(BillingPlanEnum), example: Object.values(BillingPlanEnum)[0] }
      },
      additionalProperties: false
    }
  })
  async downgradeSubscription(@Req() req: Request, @Body() body: { targetPlan: BillingPlanEnum }) {
    const tenantId = this.requireTenantId(req);
    const bodyObj = this.ensureObjectBody(body);
    this.ensurePlanId(bodyObj.targetPlan);
    const status = await this.billingService.downgradeSubscription(bodyObj.targetPlan as BillingPlanEnum);
    return { tenantId, ...status };
  }

  @Post('billing/cancel')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', example: 'Testing cancel flow' }
      },
      additionalProperties: false
    }
  })
  async cancelSubscription(@Req() req: Request, @Body() body: { reason?: string }) {
    const tenantId = this.requireTenantId(req);
    const bodyObj = (body ?? {}) as Record<string, any>;
    const status = await this.billingService.cancelSubscription({
      reason: typeof bodyObj.reason === 'string' ? bodyObj.reason : undefined
    } as any);
    return { tenantId, ...status };
  }

  @Post('billing/reactivate')
  async reactivateSubscription(@Req() req: Request) {
    const tenantId = this.requireTenantId(req);
    const status = await this.billingService.reactivateSubscription();
    return { tenantId, ...status };
  }

  @Post('usage/increment')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['metric'],
      properties: {
        metric: { type: 'string', example: 'campaigns' },
        amount: { type: 'number', example: 1 }
      },
      additionalProperties: false
    }
  })
  async incrementUsage(@Req() req: Request, @Body() body: { metric: string; amount?: number }) {
    const tenantId = this.requireTenantId(req);
    const bodyObj = this.ensureObjectBody(body);
    this.ensureRequiredString(bodyObj.metric, 'metric');
    const amount = Number.isFinite(bodyObj.amount) ? Number(bodyObj.amount) : 1;
    await this.planLimitService.enforceLimit(tenantId, bodyObj.metric, amount);
    const currentUsage = await this.usageTracker.increment(bodyObj.metric, amount);
    const periodDate = new Date().toISOString().slice(0, 10);
    return { tenantId, metric: bodyObj.metric, amount, currentUsage, periodDate };
  }

  @Post('usage/decrement')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['metric'],
      properties: {
        metric: { type: 'string', example: 'campaigns' },
        amount: { type: 'number', example: 1 }
      },
      additionalProperties: false
    }
  })
  async decrementUsage(@Req() req: Request, @Body() body: { metric: string; amount?: number }) {
    const tenantId = this.requireTenantId(req);
    const bodyObj = this.ensureObjectBody(body);
    this.ensureRequiredString(bodyObj.metric, 'metric');
    const amount = Number.isFinite(bodyObj.amount) ? Number(bodyObj.amount) : 1;
    const currentUsage = await this.usageTracker.decrement(bodyObj.metric, amount);
    const periodDate = new Date().toISOString().slice(0, 10);
    return { tenantId, metric: bodyObj.metric, amount, currentUsage, periodDate };
  }

  private ensureObjectBody(body: unknown, errorMessage = 'Request body is required'): Record<string, any> {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException(errorMessage);
    }
    return body as Record<string, any>;
  }

  private ensureRequiredString(value: unknown, fieldName: string): void {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${fieldName} is required`);
    }
  }

  private ensurePlanId(value: unknown): void {
    if (typeof value !== 'string' || !Object.values(BillingPlanEnum).includes(value as BillingPlanEnum)) {
      throw new BadRequestException(`planId is required and must be one of: ${Object.values(BillingPlanEnum).join(', ')}`);
    }
  }

  private requireTenantId(req: Request): string {
    const tenantId =
      (this.cls.get('tenantId') as string | undefined) ||
      (req.headers['tenant-id'] as string | undefined);

    if (!tenantId) {
      throw new BadRequestException('tenant-id header is required');
    }

    this.cls.set('tenantId', tenantId);
    return tenantId;
  }

  @Get('tenant/payment-status')
  async getTenantPaymentStatus(@Req() req: Request) {
    const tenantId = this.requireTenantId(req);

    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId }
    });

    if (!tenant) {
      return {
        tenantId,
        found: false
      };
    }

    return {
      tenantId,
      found: true,
      status: tenant.status,
      paymentStatus: tenant.paymentStatus,
      paymentStatusChangedAt: tenant.paymentStatusChangedAt?.toISOString() ?? null
    };
  }

  @Get('billing/entity')
  async getBillingEntity(@Req() req: Request) {
    const tenantId = this.requireTenantId(req);

    const billing = await this.billingEntityRepository.findOne({
      where: { tenantId }
    });

    if (!billing) {
      return {
        tenantId,
        found: false
      };
    }

    return {
      tenantId,
      found: true,
      id: billing.id,
      plan: billing.plan,
      subscriptionStatus: billing.status,
      stripeCustomerId: billing.stripeCustomerId ?? null,
      stripeSubscriptionId: billing.stripeSubscriptionId ?? null,
      stripeTransactionId: billing.stripeTransactionId ?? null,
      pendingDowngradePlan: billing.pendingDowngradePlan ?? null,
      downgradeScheduledAt: billing.downgradeScheduledAt?.toISOString() ?? null,
      cancellationReason: billing.cancellationReason ?? null,
      cancellationRequestedAt: billing.cancellationRequestedAt?.toISOString() ?? null,
      cancellationEffectiveAt: billing.cancellationEffectiveAt?.toISOString() ?? null
    };
  }

  @Get('billing/events')
  async getRecentBillingEvents(@Req() req: Request, @Query('limit') limitRaw?: string) {
    const tenantId = this.requireTenantId(req);

    const requested = Number(limitRaw);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(100, Math.floor(requested)) : 20;

    const events = await this.billingEventRepository.find({
      where: { tenantId },
      order: { timestamp: 'DESC' },
      take: limit
    });

    return {
      tenantId,
      limit,
      events: events.map(e => ({
        id: e.id,
        eventType: e.eventType,
        metricName: e.metricName ?? null,
        increment: e.increment ?? null,
        timestamp: e.timestamp?.toISOString() ?? null,
        metadata: e.metadata ?? null
      }))
    };
  }

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

  @Post('plans/seed-manual')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Manual Dev Plan' },
        limits: {
          type: 'object',
          properties: {
            referred_users: { type: 'number', example: 1000 },
            campaigns: { type: 'number', example: 100 },
            seats: { type: 'number', example: 10 },
            leaderboard_entries: { type: 'number', example: 10000 },
            email_sends: { type: 'number', example: 50000 }
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  })
  async seedManualPlan(
    @Req() req: Request,
    @Body() body: { name?: string; limits?: Record<string, number> }
  ) {
    const tenantId =
      (this.cls.get('tenantId') as string | undefined) ||
      (req.headers['tenant-id'] as string | undefined);

    if (!tenantId) {
      return {
        error: 'TENANT_ID_REQUIRED',
        message: 'Provide tenant id via tenant-id header (TenantMiddleware stores it in CLS as tenantId).'
      };
    }

    const bodyObj = (body ?? {}) as Record<string, any>;
    const limits = (bodyObj.limits ?? {}) as Record<string, number>;

    const saved = await this.planService.create({
      name: typeof bodyObj.name === 'string' && bodyObj.name.trim().length > 0 ? bodyObj.name.trim() : 'Manual Dev Plan',
      tenantId,
      manualInvoicing: true,
      isActive: true,
      limits: {
        referred_users: Number.isFinite(limits.referred_users) ? limits.referred_users : 1000,
        campaigns: Number.isFinite(limits.campaigns) ? limits.campaigns : 100,
        seats: Number.isFinite(limits.seats) ? limits.seats : 10,
        leaderboard_entries: Number.isFinite(limits.leaderboard_entries) ? limits.leaderboard_entries : 10000,
        email_sends: Number.isFinite(limits.email_sends) ? limits.email_sends : 50000
      }
    } as any);

    return {
      ok: true,
      tenantId,
      planId: saved.id,
      limits: saved.limits
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

  @Post('usage/run-daily-snapshot')
  async runDailySnapshot() {
    await this.dailyUsageCalculator.runDailySnapshot();
    return {
      ok: true,
      message: 'Daily usage snapshot executed'
    };
  }

  @Post('usage/run-monthly-reset')
  async runMonthlyReset() {
    await this.monthlyUsageResetService.runMonthlyReset();
    return {
      ok: true,
      message: 'Monthly usage reset executed'
    };
  }

  @Get('remaining-capacity/:metric')
  async getRemainingCapacity(@Req() req: Request, @Param('metric') metric: string) {
    const tenantId =
      (this.cls.get('tenantId') as string | undefined) ||
      (req.headers['tenant-id'] as string | undefined);

    if (!tenantId) {
      return {
        error: 'TENANT_ID_REQUIRED',
        message: 'Provide tenant id via tenant-id header (TenantMiddleware stores it in CLS as tenantId).',
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
    gracePercentage: 0,
  })
  async limitedCampaignTest(@Req() req: Request) {
    const tenantId = this.requireTenantId(req);

    const metric = 'campaigns';
    const amount = 1;
    const gracePercentage = 0;

    const plan = await this.planLimitService.getCurrentPlanForTenant(tenantId);

    const limits = await this.planLimitService.getPlanLimits(tenantId);
    const rawLimit = limits ? (limits as Record<string, number | undefined>)[metric] : undefined;
    const limit = rawLimit == null ? null : rawLimit;

    const currentUsageBefore = await this.usageTracker.getUsage(metric);

    const effectiveLimit =
      limit != null && gracePercentage > 0 ? Math.floor(limit * (1 + gracePercentage / 100)) : limit;

    const remainingBefore = effectiveLimit != null ? Math.max(0, effectiveLimit - currentUsageBefore) : null;

    // Simulate a real "create campaign" by recording usage after the guard allows the request.
    const currentUsageAfter = await this.usageTracker.increment(metric, amount);
    const remainingAfter = effectiveLimit != null ? Math.max(0, effectiveLimit - currentUsageAfter) : null;

    return {
      tenantId,
      plan,
      message: 'BillingGuard allowed the request; returning resolved plan + usage values for verification.',
      metric,
      amount,
      gracePercentage,
      limits,
      limit,
      effectiveLimit,
      currentUsageBefore,
      remainingBefore,
      currentUsageAfter,
      remainingAfter,
    };
  }
}