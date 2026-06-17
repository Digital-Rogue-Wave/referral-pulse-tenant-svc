import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Plan } from '@prisma-gen/generated/client';
import type { AllConfigType } from '@config/config.type';
import { BillingPlanEnum, SubscriptionStatusEnum } from '@common/enums/billing.enum';

import { DatabaseService } from '@app/database/database.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisService } from '@common/redis/redis.service';
import { LimitExceededException } from './exceptions/limit-exceeded.exception';
import type { PlanLimits } from './plan-limits.type';

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

@Injectable()
export class PlanLimitService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly redis: RedisService,
        private readonly tenantContext: TenantContextService,
        private readonly configService: ConfigService<AllConfigType>
    ) {
        this.logger.setContext(PlanLimitService.name);
    }

    private buildUpgradeUrl(): string | null {
        const frontend = this.configService.get('app.frontendDomain', {
            infer: true
        });
        if (!frontend) {
            return null;
        }
        return `${frontend.replace(/\/$/, '')}/billing`;
    }

    private async enforceTrialExpiryOrThrow(tenantId: string): Promise<void> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId }
        });

        if (!tenant?.trialEndsAt) {
            return;
        }

        const now = new Date();
        if (tenant.trialEndsAt > now) {
            return;
        }

        const manualPlan = await this.prisma.plan.findFirst({
            where: {
                tenantId,
                isActive: true,
                manualInvoicing: true,
                deletedAt: null
            }
        });

        if (manualPlan) {
            return;
        }

        const billing = await this.prisma.billing.findUnique({
            where: { tenantId }
        });
        if (billing?.status === SubscriptionStatusEnum.ACTIVE) {
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

    private getStripePriceIdForPlan(plan: string): string | null {
        const cfg = this.configService.get('stripeConfig', { infer: true });
        if (!cfg) {
            return null;
        }

        switch (plan) {
            case BillingPlanEnum.FREE:
                return (cfg as Record<string, string | undefined>).freePriceId ?? null;
            case BillingPlanEnum.STARTER:
                return (cfg as Record<string, string | undefined>).starterPriceId ?? null;
            case BillingPlanEnum.GROWTH:
                return (cfg as Record<string, string | undefined>).growthPriceId ?? null;
            case BillingPlanEnum.ENTERPRISE:
                return (cfg as Record<string, string | undefined>).enterprisePriceId ?? null;
            default:
                return null;
        }
    }

    private async resolvePlanForTenant(tenantId: string): Promise<Plan | null> {
        const manualPlan = await this.prisma.plan.findFirst({
            where: {
                tenantId,
                isActive: true,
                manualInvoicing: true,
                deletedAt: null
            }
        });

        if (manualPlan) {
            return manualPlan;
        }

        const billing = await this.prisma.billing.findUnique({
            where: { tenantId }
        });

        if (!billing) {
            this.logger.debug(`No Billing found for tenant ${tenantId} when resolving plan limits; defaulting to FREE plan`);

            const freeStripePriceId = this.getStripePriceIdForPlan(BillingPlanEnum.FREE);
            if (!freeStripePriceId) {
                this.logger.debug(`No Stripe price mapping found for plan ${BillingPlanEnum.FREE} when resolving plan limits for tenant ${tenantId}`);
                return null;
            }

            const freePlan = await this.prisma.plan.findFirst({
                where: {
                    stripePriceId: freeStripePriceId,
                    tenantId: null,
                    isActive: true,
                    deletedAt: null
                }
            });

            if (!freePlan) {
                this.logger.debug(`No Plan found for FREE stripePriceId=${freeStripePriceId} when resolving plan limits for tenant ${tenantId}`);
            }

            return freePlan ?? null;
        }

        const stripePriceId = this.getStripePriceIdForPlan(billing.plan);
        if (!stripePriceId) {
            this.logger.debug(`No Stripe price mapping found for plan ${billing.plan} when resolving plan limits for tenant ${tenantId}`);
            return null;
        }

        const plan = await this.prisma.plan.findFirst({
            where: {
                stripePriceId,
                tenantId: null,
                isActive: true,
                deletedAt: null
            }
        });

        if (!plan) {
            this.logger.debug(`No Plan found for stripePriceId=${stripePriceId} when resolving plan limits for tenant ${tenantId}`);
        }

        return plan ?? null;
    }

    async getPlanLimits(tenantId: string): Promise<PlanLimits | null> {
        const plan = await this.resolvePlanForTenant(tenantId);
        return (plan?.limits as PlanLimits | null) ?? null;
    }

    async getCurrentPlanForTenant(tenantId: string): Promise<BillingPlanEnum> {
        const billing = await this.prisma.billing.findUnique({
            where: { tenantId }
        });
        return (billing?.plan as BillingPlanEnum) ?? BillingPlanEnum.FREE;
    }

    async getRemainingCapacity(tenantId: string, metric: string): Promise<number | null> {
        const limits = await this.getPlanLimits(tenantId);
        const rawLimit = limits ? (limits as Record<string, number | undefined>)[metric] : undefined;

        if (rawLimit === null || rawLimit === undefined) {
            return 0;
        }

        const currentUsage = await this.tenantContext.runWithContext({ tenantId }, () => this.redis.getUsage(metric));
        const remaining = rawLimit - currentUsage;
        return remaining >= 0 ? remaining : 0;
    }

    async canPerformAction(tenantId: string, action: string, count = 1): Promise<PlanLimitCheckResult> {
        const metric = action;
        const limits = await this.getPlanLimits(tenantId);
        const rawLimit = limits ? (limits as Record<string, number | undefined>)[metric] : undefined;

        const currentUsage = await this.tenantContext.runWithContext({ tenantId }, () => this.redis.getUsage(metric));

        if (rawLimit === null || rawLimit === undefined) {
            return {
                metric,
                currentUsage,
                limit: null,
                remaining: null,
                allowed: true
            };
        }

        const limit = rawLimit;
        const remaining = limit - currentUsage;
        const allowed = remaining >= count;

        return {
            metric,
            currentUsage,
            limit,
            remaining: remaining >= 0 ? remaining : 0,
            allowed
        };
    }

    async enforceLimit(tenantId: string, metric: string, value: number, options?: EnforceLimitOptions): Promise<void> {
        if (value <= 0) {
            return;
        }

        await this.enforceTrialExpiryOrThrow(tenantId);

        const limits = await this.getPlanLimits(tenantId);
        const rawLimit = limits ? (limits as Record<string, number | undefined>)[metric] : undefined;

        const currentUsage = await this.tenantContext.runWithContext({ tenantId }, () => this.redis.getUsage(metric));

        if (rawLimit === null || rawLimit === undefined) {
            return;
        }

        const limit = rawLimit;

        let effectiveLimit = limit;
        if (options?.gracePercentage && options.gracePercentage > 0) {
            const factor = 1 + options.gracePercentage / 100;
            effectiveLimit = Math.floor(limit * factor);
        }

        const nextValue = currentUsage + value;
        const remaining = Math.max(0, effectiveLimit - currentUsage);

        if (nextValue > effectiveLimit) {
            const upgradeSuggestions = options?.upgradeSuggestions ?? [`Upgrade your subscription plan to increase the allowed ${metric} limit.`];

            const upgradeUrl = options?.upgradeUrl ?? null;

            throw new LimitExceededException({
                metric,
                currentUsage,
                limit,
                requestedAmount: value,
                remaining,
                effectiveLimit,
                upgradeSuggestions,
                upgradeUrl
            });
        }
    }
}
