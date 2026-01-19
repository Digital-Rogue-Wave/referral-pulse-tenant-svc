import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';
import { BillingEntity } from './billing.entity';
import { BillingPlanEnum, SubscriptionStatusEnum } from '@mod/common/enums/billing.enum';
import { PlanEntity } from './plan.entity';
import { RedisService } from '@mod/common/aws-redis/redis.service';
import { RedisKeyBuilder } from '@mod/common/aws-redis/redis-key.builder';

@Injectable()
export class TrialLifecycleService {
    private readonly logger = new Logger(TrialLifecycleService.name);

    private static readonly REMINDER_DAYS = [3, 1];
    private static readonly DEDUP_TTL_SECONDS = 45 * 24 * 60 * 60;

    constructor(
        @InjectRepository(TenantEntity)
        private readonly tenantRepository: Repository<TenantEntity>,
        @InjectRepository(BillingEntity)
        private readonly billingRepository: Repository<BillingEntity>,
        @InjectRepository(PlanEntity)
        private readonly planRepository: Repository<PlanEntity>,
        private readonly redis: RedisService,
        private readonly keyBuilder: RedisKeyBuilder,
        private readonly eventEmitter: EventEmitter2
    ) {}

    async runDailyLifecycle(now = new Date()): Promise<void> {
        const tenants = await this.tenantRepository.find({ where: { status: TenantStatusEnum.ACTIVE } });

        for (const tenant of tenants) {
            if (!tenant.trialEndsAt) {
                continue;
            }

            const trialEndsAt = tenant.trialEndsAt;
            const msRemaining = trialEndsAt.getTime() - now.getTime();

            if (msRemaining <= 0) {
                await this.handleTrialExpired(tenant, now);
                continue;
            }

            const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

            if (TrialLifecycleService.REMINDER_DAYS.includes(daysRemaining)) {
                await this.handleTrialReminder(tenant.id, trialEndsAt, daysRemaining, now);
            }
        }
    }

    private async handleTrialReminder(tenantId: string, trialEndsAt: Date, daysRemaining: number, now: Date): Promise<void> {
        const dedupKey = this.keyBuilder.build('trial', 'reminder', tenantId, String(daysRemaining), trialEndsAt.toISOString().slice(0, 10));
        const shouldEmit = await this.redis.setNx(dedupKey, '1', TrialLifecycleService.DEDUP_TTL_SECONDS);

        if (!shouldEmit) {
            return;
        }

        this.eventEmitter.emit('trial.reminder', {
            tenantId,
            daysRemaining,
            trialEndsAt: trialEndsAt.toISOString(),
            triggeredAt: now.toISOString()
        });
    }

    private async handleTrialExpired(tenant: TenantEntity, now: Date): Promise<void> {
        const tenantId = tenant.id;

        const manualPlan = await this.planRepository.findOne({
            where: {
                tenantId,
                isActive: true,
                manualInvoicing: true
            }
        });

        if (manualPlan) {
            return;
        }

        const billing = await this.ensureBillingForTenant(tenantId);

        if (billing.status === SubscriptionStatusEnum.ACTIVE) {
            return;
        }

        if (billing.plan !== BillingPlanEnum.FREE || billing.status !== SubscriptionStatusEnum.NONE) {
            billing.plan = BillingPlanEnum.FREE;
            billing.status = SubscriptionStatusEnum.NONE;
            billing.pendingDowngradePlan = null;
            billing.downgradeScheduledAt = null;
            billing.cancellationReason = null;
            billing.cancellationRequestedAt = null;
            billing.cancellationEffectiveAt = null;
            billing.stripeSubscriptionId = null;
            await this.billingRepository.save(billing);

            this.eventEmitter.emit('subscription.changed', {
                tenantId: billing.tenantId,
                billingPlan: billing.plan,
                subscriptionStatus: billing.status,
                stripeCustomerId: billing.stripeCustomerId ?? undefined,
                stripeSubscriptionId: billing.stripeSubscriptionId ?? undefined
            });
        }

        const oldTrialEndsAt = tenant.trialEndsAt;
        tenant.trialEndsAt = undefined;
        await this.tenantRepository.save(tenant);

        const dedupKey = this.keyBuilder.build('trial', 'expired', tenantId, (oldTrialEndsAt ?? now).toISOString().slice(0, 10));
        const shouldEmit = await this.redis.setNx(dedupKey, '1', TrialLifecycleService.DEDUP_TTL_SECONDS);

        if (!shouldEmit) {
            return;
        }

        this.eventEmitter.emit('trial.expired', {
            tenantId,
            trialEndsAt: (oldTrialEndsAt ?? now).toISOString(),
            downgradedTo: BillingPlanEnum.FREE,
            triggeredAt: now.toISOString()
        });
    }

    private async ensureBillingForTenant(tenantId: string): Promise<BillingEntity> {
        const existing = await this.billingRepository.findOne({ where: { tenantId } });
        if (existing) {
            return existing;
        }

        const created = this.billingRepository.create({
            tenantId,
            plan: BillingPlanEnum.FREE,
            status: SubscriptionStatusEnum.NONE
        });

        return this.billingRepository.save(created);
    }
}
