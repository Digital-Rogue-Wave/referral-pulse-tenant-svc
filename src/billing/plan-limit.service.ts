import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { PlanEntity } from './plan.entity';
import { BillingEntity } from './billing.entity';
import { RedisUsageService } from './redis-usage.service';
import type { PlanLimits } from './plan-limits.type';
import { BillingPlanEnum } from '@mod/common/enums/billing.enum';
import { ConfigService } from '@nestjs/config';
import type { AllConfigType } from '@mod/config/config.type';
import { LimitExceededException } from './exceptions/limit-exceeded.exception';

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
    private readonly logger = new Logger(PlanLimitService.name);

    constructor(
        @InjectRepository(PlanEntity)
        private readonly planRepository: Repository<PlanEntity>,
        @InjectRepository(BillingEntity)
        private readonly billingRepository: Repository<BillingEntity>,
        private readonly redisUsageService: RedisUsageService,
        private readonly configService: ConfigService<AllConfigType>
    ) {}

    private getStripePriceIdForPlan(plan: BillingPlanEnum): string | null {
        const cfg = this.configService.get('stripeConfig', { infer: true });
        if (!cfg) {
            return null;
        }

        switch (plan) {
            case BillingPlanEnum.FREE:
                return (cfg as any).freePriceId ?? null;
            case BillingPlanEnum.STARTER:
                return (cfg as any).starterPriceId ?? null;
            case BillingPlanEnum.GROWTH:
                return (cfg as any).growthPriceId ?? null;
            case BillingPlanEnum.ENTERPRISE:
                return (cfg as any).enterprisePriceId ?? null;
            default:
                return null;
        }
    }

    private async resolvePlanForTenant(tenantId: string): Promise<PlanEntity | null> {
        const manualPlan = await this.planRepository.findOne({
            where: {
                tenantId,
                isActive: true,
                manualInvoicing: true
            }
        });

        if (manualPlan) {
            return manualPlan;
        }

        const billing = await this.billingRepository.findOne({ where: { tenantId } });

        if (!billing) {
            this.logger.debug(
                `No BillingEntity found for tenant ${tenantId} when resolving plan limits; defaulting to FREE plan`
            );

            const freeStripePriceId = this.getStripePriceIdForPlan(BillingPlanEnum.FREE);
            if (!freeStripePriceId) {
                this.logger.debug(
                    `No Stripe price mapping found for plan ${BillingPlanEnum.FREE} when resolving plan limits for tenant ${tenantId}`
                );
                return null;
            }

            const freePlan = await this.planRepository.findOne({
                where: {
                    stripePriceId: freeStripePriceId,
                    tenantId: IsNull(),
                    isActive: true
                }
            });

            if (!freePlan) {
                this.logger.debug(
                    `No PlanEntity found for FREE stripePriceId=${freeStripePriceId} when resolving plan limits for tenant ${tenantId}`
                );
            }

            return freePlan ?? null;
        }

        const stripePriceId = this.getStripePriceIdForPlan(billing.plan);
        if (!stripePriceId) {
            this.logger.debug(
                `No Stripe price mapping found for plan ${billing.plan} when resolving plan limits for tenant ${tenantId}`
            );
            return null;
        }

        const plan = await this.planRepository.findOne({
            where: {
                stripePriceId,
                tenantId: IsNull(),
                isActive: true
            }
        });

        if (!plan) {
            this.logger.debug(
                `No PlanEntity found for stripePriceId=${stripePriceId} when resolving plan limits for tenant ${tenantId}`
            );
        }

        return plan ?? null;
    }

    async getPlanLimits(tenantId: string): Promise<PlanLimits | null> {
        const plan = await this.resolvePlanForTenant(tenantId);
        return plan?.limits ?? null;
    }

    async getCurrentPlanForTenant(tenantId: string): Promise<BillingPlanEnum> {
        const billing = await this.billingRepository.findOne({ where: { tenantId } });
        return billing?.plan ?? BillingPlanEnum.FREE;
    }

    async getRemainingCapacity(tenantId: string, metric: string): Promise<number | null> {
        const limits = await this.getPlanLimits(tenantId);
        const rawLimit = limits ? (limits as Record<string, number | undefined>)[metric] : undefined;

        if (rawLimit == null) {
            return null;
        }

        const currentUsage = await this.redisUsageService.getUsage(tenantId, metric);
        const remaining = rawLimit - currentUsage;
        return remaining >= 0 ? remaining : 0;
    }

    async canPerformAction(tenantId: string, action: string, count = 1): Promise<PlanLimitCheckResult> {
        const metric = action;
        const limits = await this.getPlanLimits(tenantId);
        const rawLimit = limits ? (limits as Record<string, number | undefined>)[metric] : undefined;

        const currentUsage = await this.redisUsageService.getUsage(tenantId, metric);

        if (rawLimit == null) {
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

        const limits = await this.getPlanLimits(tenantId);
        const rawLimit = limits ? (limits as Record<string, number | undefined>)[metric] : undefined;

        const currentUsage = await this.redisUsageService.getUsage(tenantId, metric);

        if (rawLimit == null) {
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
            const upgradeSuggestions =
                options?.upgradeSuggestions ?? [`Upgrade your subscription plan to increase the allowed ${metric} limit.`];

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