import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Plan } from '@prisma-gen/generated/client';
import type { AllConfigType } from '@config/config.type';
import { BillingPlanEnum, LIVE_SUBSCRIPTION_STATUSES } from '@common/enums/billing.enum';
import { InvitationStatusEnum } from '@common/enums/invitation.enum';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DomainMetrics } from '@common/monitoring/domain-metrics.service';
import { LimitExceededException } from './exceptions/limit-exceeded.exception';
import type { PlanLimits } from './plan-limits.type';
import type { TenantEntitlementsDto } from '@domains/billing';
import { UsageCounterService } from './usage-counter.service';

export interface PlanLimitCheckResult {
    metric: string;
    currentUsage: number;
    limit: number | null;
    remaining: number | null;
    allowed: boolean;
}

export interface EnforceLimitOptions {
    gracePercentage?: number;
    upgradeUrl?: string | null;
    upgradeSuggestions?: string[];
}

/** Seats are counted, not metered: the tenant's operators plus the invitations that can still be accepted. */
export const SEATS_METRIC = 'seats';

/**
 * Plan entitlements. Limits come from the `plans` catalog (data, not code): the tenant's manual-invoicing
 * plan if it has one, otherwise the catalog plan named by `billings.plan`. A metric without a limit is
 * unlimited. Usage comes from the durable `usage_counters`.
 */
@Injectable()
export class PlanLimitService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly counters: UsageCounterService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly domainMetrics: DomainMetrics
    ) {
        this.logger.setContext(PlanLimitService.name);
    }

    async getPlanLimits(tenantId: string): Promise<PlanLimits | null> {
        const plan = await this.resolvePlanForTenant(tenantId);
        return (plan?.limits as PlanLimits | null) ?? null;
    }

    /** Limits of a catalog plan, e.g. to validate a downgrade before it is scheduled. */
    async limitsOfPlan(planName: string): Promise<PlanLimits | null> {
        const plan = await this.prisma.plan.findFirst({ where: { name: planName, tenantId: null, isActive: true, deletedAt: null } });
        return (plan?.limits as PlanLimits | null) ?? null;
    }

    async getCurrentPlanForTenant(tenantId: string): Promise<BillingPlanEnum> {
        const billing = await this.prisma.billing.findUnique({ where: { tenantId } });
        return (billing?.plan as BillingPlanEnum) ?? BillingPlanEnum.FREE;
    }

    /** Remaining capacity; null when the metric is unlimited. */
    async getRemainingCapacity(tenantId: string, metric: string): Promise<number | null> {
        const limit = limitOf(await this.getPlanLimits(tenantId), metric);
        if (limit === null) {
            return null;
        }
        return Math.max(0, limit - (await this.usageOf(tenantId, metric)));
    }

    async canPerformAction(tenantId: string, metric: string, count = 1): Promise<PlanLimitCheckResult> {
        const limit = limitOf(await this.getPlanLimits(tenantId), metric);
        const currentUsage = await this.usageOf(tenantId, metric);
        if (limit === null) {
            return { metric, currentUsage, limit: null, remaining: null, allowed: true };
        }
        const remaining = Math.max(0, limit - currentUsage);
        return { metric, currentUsage, limit, remaining, allowed: remaining >= count };
    }

    /**
     * Meters `amount` against the plan, atomically: it is added only if the result stays within the limit,
     * so concurrent callers cannot overshoot it. Throws when the limit (or the trial) is exhausted.
     */
    async consume(tenantId: string, metric: string, amount = 1): Promise<number> {
        await this.enforceTrialExpiryOrThrow(tenantId);
        const limit = limitOf(await this.getPlanLimits(tenantId), metric);
        const value = await this.counters.consume(tenantId, metric, amount, limit);
        if (value === null) {
            throw this.exceeded(metric, await this.counters.get(tenantId, metric), limit ?? 0, amount);
        }
        return value;
    }

    async release(tenantId: string, metric: string, amount = 1): Promise<number> {
        return this.counters.release(tenantId, metric, amount);
    }

    /** Before adding operators or invitations: users plus open invitations must stay within the seat limit. */
    async assertSeatAvailable(tenantId: string, adding = 1): Promise<void> {
        await this.assertCapacity(tenantId, SEATS_METRIC, await this.seatsInUse(tenantId), adding);
    }

    /** For resources counted in their own table (API keys, …): `current + adding` must fit the plan. */
    async assertCapacity(tenantId: string, metric: string, current: number, adding = 1): Promise<void> {
        const limit = limitOf(await this.getPlanLimits(tenantId), metric);
        if (limit !== null && current + adding > limit) {
            throw this.exceeded(metric, current, limit, adding);
        }
    }

    /**
     * A non-atomic pre-check for request guards; metering itself goes through {@link consume}.
     */
    async enforceLimit(tenantId: string, metric: string, value: number, options?: EnforceLimitOptions): Promise<void> {
        if (value <= 0) {
            return;
        }
        await this.enforceTrialExpiryOrThrow(tenantId);
        const limit = limitOf(await this.getPlanLimits(tenantId), metric);
        if (limit === null) {
            return;
        }
        const effectiveLimit = options?.gracePercentage ? Math.floor(limit * (1 + options.gracePercentage / 100)) : limit;
        const currentUsage = await this.usageOf(tenantId, metric);
        if (currentUsage + value > effectiveLimit) {
            throw this.exceeded(metric, currentUsage, limit, value, effectiveLimit, options);
        }
    }

    /** The tenant's entitlements for other services: plan, limits, usage and the state that gates access. */
    async entitlementsOf(tenantId: string): Promise<TenantEntitlementsDto | null> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) {
            return null;
        }
        const billing = await this.prisma.billing.findUnique({ where: { tenantId }, select: { plan: true, status: true } });
        const limits = (await this.getPlanLimits(tenantId)) ?? {};
        const counted = await this.counters.current(tenantId);
        const usage: Record<string, number> = { ...counted, [SEATS_METRIC]: await this.seatsInUse(tenantId) };
        for (const metric of Object.keys(limits)) {
            usage[metric] ??= 0;
        }
        return {
            tenantId,
            plan: billing?.plan ?? BillingPlanEnum.FREE,
            subscriptionStatus: billing?.status ?? 'none',
            tenantStatus: tenant.status,
            paymentStatus: tenant.paymentStatus,
            trialEndsAt: tenant.trialEndsAt,
            dataRegion: tenant.dataRegion,
            retentionMonths: tenant.retentionMonths,
            limits: Object.fromEntries(Object.keys(limits).map((metric) => [metric, limitOf(limits, metric)])),
            usage
        };
    }

    async seatsInUse(tenantId: string): Promise<number> {
        const [users, invitations] = await Promise.all([
            this.prisma.user.count({ where: { tenantId, deletedAt: null } }),
            this.prisma.invitation.count({ where: { tenantId, status: InvitationStatusEnum.PENDING, expiresAt: { gt: new Date() } } })
        ]);
        return users + invitations;
    }

    async usageOf(tenantId: string, metric: string): Promise<number> {
        return metric === SEATS_METRIC ? this.seatsInUse(tenantId) : this.counters.get(tenantId, metric);
    }

    private exceeded(metric: string, currentUsage: number, limit: number, requested: number, effectiveLimit = limit, options?: EnforceLimitOptions) {
        this.domainMetrics.limitRejected(metric);
        return new LimitExceededException({
            metric,
            currentUsage,
            limit,
            requestedAmount: requested,
            remaining: Math.max(0, effectiveLimit - currentUsage),
            effectiveLimit,
            upgradeSuggestions: options?.upgradeSuggestions ?? [`Upgrade your plan to raise the ${metric} limit.`],
            upgradeUrl: options?.upgradeUrl ?? this.buildUpgradeUrl()
        });
    }

    private async resolvePlanForTenant(tenantId: string): Promise<Plan | null> {
        const manualPlan = await this.prisma.plan.findFirst({ where: { tenantId, isActive: true, manualInvoicing: true, deletedAt: null } });
        if (manualPlan) {
            return manualPlan;
        }
        const billing = await this.prisma.billing.findUnique({ where: { tenantId }, select: { plan: true } });
        const planName = billing?.plan ?? BillingPlanEnum.FREE;
        const plan = await this.prisma.plan.findFirst({ where: { name: planName, tenantId: null, isActive: true, deletedAt: null } });
        if (!plan) {
            this.logger.warn('No active catalog plan for the tenant; treating its limits as unset', { tenantId, plan: planName });
        }
        return plan;
    }

    private async enforceTrialExpiryOrThrow(tenantId: string): Promise<void> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { trialEndsAt: true } });
        if (!tenant?.trialEndsAt || tenant.trialEndsAt > new Date()) {
            return;
        }
        const manualPlan = await this.prisma.plan.findFirst({ where: { tenantId, isActive: true, manualInvoicing: true, deletedAt: null } });
        if (manualPlan) {
            return;
        }
        const billing = await this.prisma.billing.findUnique({ where: { tenantId }, select: { status: true } });
        if (billing && LIVE_SUBSCRIPTION_STATUSES.includes(billing.status)) {
            return;
        }
        throw new HttpException(
            {
                message: 'Trial has expired. Please upgrade your subscription to continue.',
                code: 'TRIAL_EXPIRED',
                trialEndsAt: tenant.trialEndsAt.toISOString(),
                upgradeUrl: this.buildUpgradeUrl()
            },
            HttpStatus.PAYMENT_REQUIRED
        );
    }

    private buildUpgradeUrl(): string | null {
        const frontend = this.configService.get('app.frontendDomain', { infer: true });
        return frontend ? `${frontend.replace(/\/$/, '')}/billing` : null;
    }
}

function limitOf(limits: PlanLimits | null, metric: string): number | null {
    const value = limits?.[metric];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
