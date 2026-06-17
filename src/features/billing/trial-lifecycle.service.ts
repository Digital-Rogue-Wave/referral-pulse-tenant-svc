import { Injectable } from '@nestjs/common';

import type { Tenant, Billing } from '@prisma-gen/generated/client';
import { TenantStatusEnum } from '@common/enums/tenant.enum';
import { BillingPlanEnum, SubscriptionStatusEnum } from '@common/enums/billing.enum';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisService } from '@common/redis/redis.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';

import { BillingEvents, TrialReminderEvent, TrialExpiredEvent, SubscriptionChangedEvent } from '@domains/billing';

@Injectable()
export class TrialLifecycleService {
    private static readonly REMINDER_DAYS = [3, 1];
    private static readonly DEDUP_TTL_SECONDS = 45 * 24 * 60 * 60;

    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly redis: RedisService,
        private readonly keyBuilder: RedisKeyBuilder,
        private readonly txEventEmitter: TransactionEventEmitterService
    ) {
        this.logger.setContext(TrialLifecycleService.name);
    }

    async runDailyLifecycle(now = new Date()): Promise<void> {
        const tenants = await this.prisma.tenant.findMany({
            where: {
                status: TenantStatusEnum.ACTIVE,
                deletedAt: null
            }
        });

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
        const dedupKey = this.keyBuilder.buildDedupKey(
            `trial-reminder-${tenantId}-${String(daysRemaining)}-${trialEndsAt.toISOString().slice(0, 10)}`,
            false
        );
        const shouldEmit = await this.redis.setNx(dedupKey, '1', TrialLifecycleService.DEDUP_TTL_SECONDS);

        if (!shouldEmit) {
            return;
        }

        this.txEventEmitter.emitAfterCommit(
            BillingEvents.TRIAL_REMINDER,
            new TrialReminderEvent(tenantId, tenantId, trialEndsAt.toISOString(), daysRemaining, now.toISOString())
        );
    }

    private async handleTrialExpired(tenant: Tenant, now: Date): Promise<void> {
        const tenantId = tenant.id;

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

        const billing = await this.ensureBillingForTenant(tenantId);

        if (billing.status === SubscriptionStatusEnum.ACTIVE) {
            return;
        }

        if (billing.plan !== BillingPlanEnum.FREE || billing.status !== SubscriptionStatusEnum.NONE) {
            await this.prisma.billing.update({
                where: { id: billing.id },
                data: {
                    plan: BillingPlanEnum.FREE,
                    status: SubscriptionStatusEnum.NONE,
                    pendingDowngradePlan: null,
                    downgradeScheduledAt: null,
                    cancellationReason: null,
                    cancellationRequestedAt: null,
                    cancellationEffectiveAt: null,
                    stripeSubscriptionId: null
                }
            });

            this.txEventEmitter.emitAfterCommit(
                BillingEvents.SUBSCRIPTION_CHANGED,
                new SubscriptionChangedEvent(
                    billing.id,
                    billing.tenantId,
                    BillingPlanEnum.FREE,
                    SubscriptionStatusEnum.NONE,
                    undefined,
                    billing.stripeCustomerId ?? undefined
                )
            );
        }

        const oldTrialEndsAt = tenant.trialEndsAt;

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { trialEndsAt: null }
        });

        const dedupKey = this.keyBuilder.buildDedupKey(`trial-expired-${tenantId}-${(oldTrialEndsAt ?? now).toISOString().slice(0, 10)}`, false);
        const shouldEmit = await this.redis.setNx(dedupKey, '1', TrialLifecycleService.DEDUP_TTL_SECONDS);

        if (!shouldEmit) {
            return;
        }

        this.txEventEmitter.emitAfterCommit(
            BillingEvents.TRIAL_EXPIRED,
            new TrialExpiredEvent(tenantId, tenantId, (oldTrialEndsAt ?? now).toISOString(), now.toISOString())
        );
    }

    private async ensureBillingForTenant(tenantId: string): Promise<Billing> {
        const existing = await this.prisma.billing.findUnique({
            where: { tenantId }
        });
        if (existing) {
            return existing;
        }

        return this.prisma.billing.create({
            data: {
                tenantId,
                plan: BillingPlanEnum.FREE,
                status: SubscriptionStatusEnum.NONE
            }
        });
    }
}
