import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import Stripe from 'stripe';

import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { BillingPlanEnum } from '@common/enums/billing.enum';
import { DatabaseService } from '@app/database/database.service';

import { PlanStripeSyncService } from './plan-stripe-sync.service';
import { BillingService } from './billing.service';
import { PlanService } from './plan.service';
import { PlanLimitService } from './plan-limit.service';
import { BillingGuardConfig } from './decorators/billing-guard.decorator';
import { BillingGuard } from './guards/billing.guard';
import { PaymentRequiredGuard } from './guards/payment-required.guard';
import { DailyUsageCalculator } from './daily-usage-calculator.service';
import { MonthlyUsageResetService } from './monthly-usage-reset.service';
import { UsageTrackerService } from './usage-tracker.service';
import { PaymentStatusEscalationService } from './payment-status-escalation.service';
import { TrialLifecycleService } from './trial-lifecycle.service';

@ApiTags('Testing')
@ApiBearerAuth()
@ApiHeader({ name: 'tenant-id', required: false })
@Controller('test')
export class TestBillingController {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly planSyncService: PlanStripeSyncService,
        private readonly billingService: BillingService,
        private readonly planService: PlanService,
        private readonly planLimitService: PlanLimitService,
        private readonly dailyUsageCalculator: DailyUsageCalculator,
        private readonly monthlyUsageResetService: MonthlyUsageResetService,
        private readonly paymentStatusEscalationService: PaymentStatusEscalationService,
        private readonly trialLifecycleService: TrialLifecycleService,
        private readonly usageTracker: UsageTrackerService,
        private readonly tenantContext: TenantContextService
    ) {}

    @Post('stripe/checkout-session')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['plan'],
            properties: {
                plan: {
                    type: 'string',
                    enum: Object.values(BillingPlanEnum),
                    example: Object.values(BillingPlanEnum)[0]
                },
                couponCode: { type: 'string', nullable: true, example: 'PROMO_CODE' }
            },
            additionalProperties: false
        }
    })
    async createRealStripeCheckoutSession(@Req() req: Request, @Body() body: { plan: BillingPlanEnum; couponCode?: string }) {
        const tenantId = this.requireTenantId();

        const bodyObj = this.ensureObjectBody(body);
        this.ensurePlanId(bodyObj.plan);

        const couponCode = typeof bodyObj.couponCode === 'string' ? bodyObj.couponCode : undefined;
        const result = await this.billingService.subscriptionCheckout(bodyObj.plan as BillingPlanEnum, couponCode);
        return {
            tenantId,
            ...result
        };
    }

    @Get('billing/subscription')
    async getBillingSubscription(@Req() req: Request) {
        const tenantId = this.requireTenantId();
        const status = await this.billingService.getCurrentSubscription();
        return { tenantId, ...status };
    }

    @Get('protected/payment-required')
    @UseGuards(PaymentRequiredGuard)
    async paymentRequiredGuardProbe(@Req() req: Request) {
        const tenantId = this.requireTenantId();
        return {
            tenantId,
            ok: true,
            message: 'PaymentRequiredGuard allowed the request.'
        };
    }

    @Get('billing/usage')
    async getBillingUsage(@Req() req: Request) {
        const tenantId = this.requireTenantId();
        const usage = await this.billingService.getUsageSummary();
        return { tenantId, ...usage };
    }

    @Post('billing/upgrade')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['targetPlan'],
            properties: {
                targetPlan: {
                    type: 'string',
                    enum: Object.values(BillingPlanEnum),
                    example: Object.values(BillingPlanEnum)[0]
                }
            },
            additionalProperties: false
        }
    })
    async upgradeSubscription(@Req() req: Request, @Body() body: { targetPlan: BillingPlanEnum }) {
        const tenantId = this.requireTenantId();
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
                targetPlan: {
                    type: 'string',
                    enum: Object.values(BillingPlanEnum),
                    example: Object.values(BillingPlanEnum)[0]
                }
            },
            additionalProperties: false
        }
    })
    async downgradeSubscription(@Req() req: Request, @Body() body: { targetPlan: BillingPlanEnum }) {
        const tenantId = this.requireTenantId();
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
        const tenantId = this.requireTenantId();
        const bodyObj = (body ?? {}) as Record<string, unknown>;
        const status = await this.billingService.cancelSubscription({
            reason: typeof bodyObj.reason === 'string' ? bodyObj.reason : undefined
        });
        return { tenantId, ...status };
    }

    @Post('billing/reactivate')
    async reactivateSubscription(@Req() req: Request) {
        const tenantId = this.requireTenantId();
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
        const tenantId = this.requireTenantId();
        const bodyObj = this.ensureObjectBody(body);
        this.ensureRequiredString(bodyObj.metric, 'metric');
        const metric = bodyObj.metric as string;
        const amount = Number.isFinite(bodyObj.amount) ? Number(bodyObj.amount) : 1;
        await this.planLimitService.enforceLimit(tenantId, metric, amount);
        const currentUsage = await this.usageTracker.increment(metric, amount);
        const periodDate = new Date().toISOString().slice(0, 10);
        return {
            tenantId,
            metric,
            amount,
            currentUsage,
            periodDate
        };
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
        const tenantId = this.requireTenantId();
        const bodyObj = this.ensureObjectBody(body);
        this.ensureRequiredString(bodyObj.metric, 'metric');
        const metric = bodyObj.metric as string;
        const amount = Number.isFinite(bodyObj.amount) ? Number(bodyObj.amount) : 1;
        const currentUsage = await this.usageTracker.decrement(metric, amount);
        const periodDate = new Date().toISOString().slice(0, 10);
        return {
            tenantId,
            metric,
            amount,
            currentUsage,
            periodDate
        };
    }

    private ensureObjectBody(body: unknown, errorMessage = 'Request body is required'): Record<string, unknown> {
        if (!body || typeof body !== 'object') {
            throw new BadRequestException(errorMessage);
        }
        return body as Record<string, unknown>;
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

    private requireTenantId(): string {
        const tenantId = this.tenantContext.getTenantId();

        if (!tenantId) {
            throw new BadRequestException('tenant-id header is required');
        }

        return tenantId;
    }

    @Get('tenant/payment-status')
    async getTenantPaymentStatus(@Req() req: Request) {
        const tenantId = this.requireTenantId();

        const tenant = await this.prisma.tenant.findUnique({
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
        const tenantId = this.requireTenantId();

        const billing = await this.prisma.billing.findUnique({
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
        const tenantId = this.requireTenantId();

        const requested = Number(limitRaw);
        const limit = Number.isFinite(requested) && requested > 0 ? Math.min(100, Math.floor(requested)) : 20;

        const events = await this.prisma.billingEvent.findMany({
            where: { tenantId },
            orderBy: { timestamp: 'desc' },
            take: limit
        });

        return {
            tenantId,
            limit,
            events: events.map((e) => ({
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
        const plans = await this.planService.getPublicPlansCached();
        return {
            count: plans.length,
            plans: plans.map((p) => ({
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
    async seedManualPlan(@Body() body: { name?: string; limits?: Record<string, number> }) {
        const tenantId = this.tenantContext.getTenantId();

        if (!tenantId) {
            throw new BadRequestException('tenant-id header is required');
        }

        const bodyObj = (body ?? {}) as Record<string, unknown>;
        const limits = (bodyObj.limits ?? {}) as Record<string, number>;

        const saved = await this.planService.create({
            name:
                typeof bodyObj.name === 'string' && (bodyObj.name as string).trim().length > 0 ? (bodyObj.name as string).trim() : 'Manual Dev Plan',
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
        });

        return {
            ok: true,
            tenantId,
            planId: saved.id,
            limits: saved.limits
        };
    }

    @Post('test-stripe-connection')
    async testStripe() {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
            apiVersion: '2026-02-25.clover'
        });

        const customers = await stripe.customers.list({ limit: 1 });

        return {
            connected: true,
            customerCount: customers.data.length,
            defaultCurrency: customers.data[0]?.currency || 'usd'
        };
    }

    @Post('jobs/run-payment-status-escalation')
    async runPaymentStatusEscalation() {
        await this.paymentStatusEscalationService.runEscalation();
        return {
            ok: true,
            message: 'Payment status escalation executed'
        };
    }

    @Post('jobs/run-trial-lifecycle')
    async runTrialLifecycle() {
        await this.trialLifecycleService.runDailyLifecycle();
        return {
            ok: true,
            message: 'Trial lifecycle executed'
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
    async getRemainingCapacity(@Param('metric') metric: string) {
        const tenantId = this.tenantContext.getTenantId();

        if (!tenantId) {
            throw new BadRequestException('tenant-id header is required');
        }

        const remaining = await this.planLimitService.getRemainingCapacity(tenantId, metric);

        return {
            tenantId,
            metric,
            remaining
        };
    }

    @Post('limited-campaign')
    @UseGuards(BillingGuard)
    @BillingGuardConfig({
        metrics: ['campaigns'],
        amount: 1,
        gracePercentage: 0
    })
    async limitedCampaignTest(@Req() req: Request) {
        const tenantId = this.requireTenantId();

        const metric = 'campaigns';
        const amount = 1;
        const gracePercentage = 0;

        const plan = await this.planLimitService.getCurrentPlanForTenant(tenantId);

        const limits = await this.planLimitService.getPlanLimits(tenantId);
        const rawLimit = limits ? (limits as Record<string, number | undefined>)[metric] : undefined;
        const limit = rawLimit ?? null;

        const currentUsageBefore = await this.usageTracker.getUsage(metric);

        const effectiveLimit = limit !== null && gracePercentage > 0 ? Math.floor(limit * (1 + gracePercentage / 100)) : limit;

        const remainingBefore = effectiveLimit !== null ? Math.max(0, effectiveLimit - currentUsageBefore) : null;

        const currentUsageAfter = await this.usageTracker.increment(metric, amount);
        const remainingAfter = effectiveLimit !== null ? Math.max(0, effectiveLimit - currentUsageAfter) : null;

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
            remainingAfter
        };
    }
}
