import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { NO_STRIPE_CUSTOMER_ERROR } from '@app/types';

import type { Billing } from '@prisma-gen/generated/client';
import { BillingPlanEnum, LIVE_SUBSCRIPTION_STATUSES, SubscriptionStatusEnum, PaymentStatusEnum } from '@common/enums/billing.enum';

import { DatabaseService } from '@app/database/database.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { TransactionEventEmitterService } from '@common/events/transaction-event-emitter.service';

import { DateService } from '@common/helper/date.service';

import { TenantService } from '@app/features/tenant/tenant.service';
import { TenantStatsService } from '@app/features/tenant/aware/tenant-stats.service';

import {
    SubscriptionCheckoutResponseDto,
    SubscriptionStatusDto,
    SubscriptionUpgradePreviewResponseDto,
    PaymentMethodSetupResponseDto,
    PaymentMethodDto,
    SubscriptionCancelRequestDto,
    InvoiceDto,
    UpcomingInvoiceDto,
    UsageSummaryDto,
    UsageMetricSummaryDto,
    UsageMetricHistoryPointDto,
    SubscriptionUpgradedEvent,
    SubscriptionDowngradeScheduledEvent,
    SubscriptionCancelledEvent,
    BillingEvents
} from '@domains/billing';

import { CursorPage, DEFAULT_PAGE_LIMIT, ListQueryDto } from '@common/http-contract/cursor-page';

import { StripeService } from './stripe.service';
import { subscriptionPeriod } from './stripe-objects';
import { PlanLimitService } from './plan-limit.service';

@Injectable()
export class BillingService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly tenantContext: TenantContextService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly stripeService: StripeService,
        private readonly tenantService: TenantService,
        private readonly tenantStatsService: TenantStatsService,
        private readonly planLimitService: PlanLimitService,
        private readonly dateService: DateService
    ) {
        this.logger.setContext(BillingService.name);
    }

    private async createBillingForTenant(): Promise<Billing> {
        const tenantId = this.tenantContext.getTenantId()!;
        let billing = await this.prisma.billing.findUnique({
            where: { tenantId }
        });

        if (!billing) {
            billing = await this.prisma.billing.create({
                data: {
                    tenantId,
                    plan: BillingPlanEnum.FREE,
                    status: SubscriptionStatusEnum.NONE
                }
            });
        }

        return billing;
    }

    async getUsageSummary(): Promise<UsageSummaryDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();
        const tenantId = billing.tenantId;

        const limits = await this.planLimitService.getPlanLimits(tenantId);

        const today = this.dateService.nowMoment();
        const todayStr = this.dateService.format(today, 'YYYY-MM-DD');

        const periodDates: string[] = [];
        for (let i = 0; i < 7; i++) {
            const d = this.dateService.subtract(today, i, 'day');
            periodDates.push(this.dateService.format(d, 'YYYY-MM-DD'));
        }

        const rows = await this.prisma.tenantUsage.findMany({
            where: {
                tenantId,
                periodDate: { in: periodDates }
            }
        });

        const metricsMap = new Map<
            string,
            {
                currentUsage: number;
                history: UsageMetricHistoryPointDto[];
            }
        >();

        for (const row of rows) {
            let entry = metricsMap.get(row.metricName);
            if (!entry) {
                entry = {
                    currentUsage: 0,
                    history: []
                };
                metricsMap.set(row.metricName, entry);
            }

            entry.history.push({
                periodDate: row.periodDate,
                usage: row.currentUsage
            });

            if (row.periodDate === todayStr) {
                entry.currentUsage = row.currentUsage;
            }
        }

        const metrics: UsageMetricSummaryDto[] = [];

        for (const [metricName, value] of metricsMap.entries()) {
            const rawLimit = limits ? (limits as Record<string, number | undefined>)[metricName] : undefined;
            const limit: number | null = rawLimit === null || rawLimit === undefined ? null : rawLimit;
            const percentageUsed: number | null = limit !== null && limit > 0 ? Math.min((value.currentUsage / limit) * 100, 100) : null;

            const history = [...value.history].sort((a, b) => a.periodDate.localeCompare(b.periodDate));

            metrics.push({
                metric: metricName,
                currentUsage: value.currentUsage,
                limit,
                percentageUsed,
                history
            });
        }

        metrics.sort((a, b) => a.metric.localeCompare(b.metric));

        return {
            plan: billing.plan as BillingPlanEnum,
            metrics
        };
    }

    private async getOrCreateBillingForCurrentTenant(): Promise<Billing> {
        return this.createBillingForTenant();
    }

    async subscriptionCheckout(plan: BillingPlanEnum, couponCode?: string): Promise<SubscriptionCheckoutResponseDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();
        const userId = this.tenantContext.getUserId();

        const session = await this.stripeService.createSubscriptionCheckoutSession({
            tenantId: billing.tenantId,
            plan,
            userId,
            couponCode,
            customerId: billing.stripeCustomerId
        });

        this.logger.log(`Created Stripe Checkout Session ${session.id} via BillingService for tenant ${billing.tenantId}, plan ${plan}`);

        return {
            plan,
            checkoutUrl: session.url ?? undefined,
            sessionId: session.id,
            paymentStatus: PaymentStatusEnum.ACTIVE
        };
    }

    async getCurrentSubscription(): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();
        const tenantId = billing.tenantId;

        let paymentStatus: PaymentStatusEnum = PaymentStatusEnum.ACTIVE;

        let trialActive: boolean | undefined;
        let trialEndsAt: Date | null = null;
        let trialDaysRemaining: number | null = null;

        try {
            const tenant = await this.tenantService.findOneById(tenantId);
            // The payment status applies whether or not the tenant ever had a trial.
            if (tenant?.paymentStatus) {
                paymentStatus = tenant.paymentStatus as PaymentStatusEnum;
            }
            trialActive = false;
            if (tenant?.trialEndsAt) {
                trialEndsAt = tenant.trialEndsAt;
                const now = new Date();
                if (tenant.trialEndsAt > now) {
                    trialActive = true;
                    trialDaysRemaining = Math.ceil(this.dateService.diff(tenant.trialEndsAt, now, 'days'));
                }
            }
        } catch (err) {
            this.logger.error(`Failed to load tenant trial info for tenant ${tenantId}`, err instanceof Error ? err.stack : String(err));
        }

        let planUsagePercentage: number | null = null;
        try {
            const stats = await this.tenantStatsService.getStats();
            planUsagePercentage = stats.planUsagePercentage ?? null;
        } catch (err) {
            this.logger.error(`Failed to load usage stats for tenant ${tenantId}`, err instanceof Error ? err.stack : String(err));
        }

        let stripeSubscriptionStatus: string | null = null;
        let stripeCurrentPeriodEnd: string | null = null;
        let stripePeriodDaysRemaining: number | null = null;
        let stripeCancelAtPeriodEnd: boolean | null = null;

        if (billing.stripeSubscriptionId) {
            try {
                const subscription = await this.stripeService.getSubscription(billing.stripeSubscriptionId);
                stripeSubscriptionStatus = subscription.status;

                const endDate = subscriptionPeriod(subscription).end;

                if (endDate) {
                    stripeCurrentPeriodEnd = this.dateService.toISO(endDate);
                    stripePeriodDaysRemaining = Math.max(0, Math.ceil(this.dateService.diff(endDate, new Date(), 'days')));
                }

                stripeCancelAtPeriodEnd = subscription.cancel_at_period_end;
            } catch (err) {
                this.logger.error(
                    `Failed to fetch Stripe subscription ${billing.stripeSubscriptionId} for tenant ${tenantId}`,
                    err instanceof Error ? err.stack : String(err)
                );
            }
        }

        return {
            plan: billing.plan as BillingPlanEnum,
            subscriptionStatus: billing.status as SubscriptionStatusEnum,
            paymentStatus,
            stripeCustomerId: billing.stripeCustomerId ?? null,
            stripeSubscriptionId: billing.stripeSubscriptionId ?? null,
            stripeTransactionId: billing.stripeTransactionId ?? null,
            trialActive,
            trialEndsAt,
            trialDaysRemaining,
            planUsagePercentage,
            stripeSubscriptionStatus,
            stripeCurrentPeriodEnd,
            stripePeriodDaysRemaining,
            stripeCancelAtPeriodEnd,
            pendingDowngradePlan: (billing.pendingDowngradePlan as BillingPlanEnum | null) ?? null,
            downgradeScheduledAt: billing.downgradeScheduledAt ?? null,
            cancellationReason: billing.cancellationReason ?? null,
            cancellationRequestedAt: billing.cancellationRequestedAt ?? null,
            cancellationEffectiveAt: billing.cancellationEffectiveAt ?? null
        };
    }

    async previewSubscriptionUpgrade(targetPlan: BillingPlanEnum): Promise<SubscriptionUpgradePreviewResponseDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to upgrade for this tenant', HttpStatus.BAD_REQUEST);
        }

        const preview = await this.stripeService.previewSubscriptionUpgrade({
            stripeSubscriptionId: billing.stripeSubscriptionId,
            targetPlan
        });

        return {
            targetPlan,
            amountDueNow: preview.amountDueNow,
            currency: preview.currency,
            nextInvoiceDate: preview.nextInvoiceDate
        };
    }

    async upgradeSubscription(targetPlan: BillingPlanEnum): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to upgrade for this tenant', HttpStatus.BAD_REQUEST);
        }

        const previousPlan = billing.plan;
        const previousStatus = billing.status;
        const userId = this.tenantContext.getUserId();

        await this.stripeService.upgradeSubscription({
            stripeSubscriptionId: billing.stripeSubscriptionId,
            targetPlan
        });

        await this.prisma.$transaction(async (tx) => {
            await tx.billing.update({
                where: { id: billing.id },
                data: {
                    plan: targetPlan,
                    status: SubscriptionStatusEnum.ACTIVE
                }
            });
            this.txEventEmitter.emitAfterCommit(
                BillingEvents.SUBSCRIPTION_UPGRADED,
                new SubscriptionUpgradedEvent(billing.id, billing.tenantId, previousPlan, targetPlan, this.dateService.nowISO(), userId ?? undefined)
            );
        });

        this.logger.log(`Subscription upgraded from ${previousPlan} to ${targetPlan}`, {
            tenantId: billing.tenantId,
            previousPlan,
            previousStatus,
            newPlan: targetPlan
        });

        return await this.getCurrentSubscription();
    }

    async createPaymentMethodSetupIntent(): Promise<PaymentMethodSetupResponseDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException(NO_STRIPE_CUSTOMER_ERROR, HttpStatus.BAD_REQUEST);
        }

        const setupIntent = await this.stripeService.createSetupIntent(billing.stripeCustomerId);

        if (!setupIntent.client_secret) {
            throw new HttpException('Failed to create Stripe SetupIntent', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        return {
            clientSecret: setupIntent.client_secret,
            customerId: billing.stripeCustomerId
        };
    }

    async listPaymentMethods(): Promise<PaymentMethodDto[]> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException(NO_STRIPE_CUSTOMER_ERROR, HttpStatus.BAD_REQUEST);
        }

        return await this.stripeService.listPaymentMethods(billing.stripeCustomerId);
    }

    async deletePaymentMethod(paymentMethodId: string): Promise<void> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException(NO_STRIPE_CUSTOMER_ERROR, HttpStatus.BAD_REQUEST);
        }

        await this.stripeService.detachPaymentMethodForCustomer(billing.stripeCustomerId, paymentMethodId);
    }

    async setDefaultPaymentMethod(paymentMethodId: string): Promise<void> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException(NO_STRIPE_CUSTOMER_ERROR, HttpStatus.BAD_REQUEST);
        }

        await this.stripeService.setDefaultPaymentMethodForCustomer(billing.stripeCustomerId, paymentMethodId);
    }

    /** Invoices, newest first, paged with Stripe's cursors (API v1.3 §1 list envelope). */
    async listInvoices(query: ListQueryDto): Promise<CursorPage<InvoiceDto>> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            return { data: [], hasMore: false, nextCursor: null, prevCursor: null };
        }

        const page = await this.stripeService.listInvoicesForCustomer(billing.stripeCustomerId, {
            limit: query.limit ?? DEFAULT_PAGE_LIMIT,
            startingAfter: query.startingAfter,
            endingBefore: query.endingBefore
        });
        const backward = !query.startingAfter && !!query.endingBefore;
        const first = page.data[0]?.id ?? null;
        const last = page.data.at(-1)?.id ?? null;
        return {
            data: page.data,
            hasMore: page.hasMore,
            nextCursor: (backward || page.hasMore) && last ? last : null,
            prevCursor: (query.startingAfter || (backward && page.hasMore)) && first ? first : null
        };
    }

    /** The Owner's link to Stripe's Customer Portal (cards, billing address, tax ids, invoice PDFs). */
    async createPortalSession(): Promise<{ url: string }> {
        const billing = await this.getOrCreateBillingForCurrentTenant();
        if (!billing.stripeCustomerId) {
            throw new HttpException(NO_STRIPE_CUSTOMER_ERROR, HttpStatus.BAD_REQUEST);
        }
        return { url: await this.stripeService.createPortalSession(billing.stripeCustomerId) };
    }

    async getUpcomingInvoice(): Promise<UpcomingInvoiceDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId || !billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to preview upcoming invoice for this tenant', HttpStatus.BAD_REQUEST);
        }

        return await this.stripeService.retrieveUpcomingInvoiceForCustomer({
            customerId: billing.stripeCustomerId,
            subscriptionId: billing.stripeSubscriptionId
        });
    }

    async cancelSubscription(dto: SubscriptionCancelRequestDto): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to cancel for this tenant', HttpStatus.BAD_REQUEST);
        }

        if (!LIVE_SUBSCRIPTION_STATUSES.includes(billing.status)) {
            throw new HttpException('Only a current subscription can be cancelled', HttpStatus.BAD_REQUEST);
        }

        const now = new Date();

        if (billing.cancellationRequestedAt && billing.cancellationEffectiveAt && billing.cancellationEffectiveAt > now) {
            throw new HttpException('Subscription cancellation is already scheduled', HttpStatus.BAD_REQUEST);
        }

        const userId = this.tenantContext.getUserId();

        const schedule = await this.stripeService.scheduleSubscriptionCancellation(billing.stripeSubscriptionId);

        await this.prisma.$transaction(async (tx) => {
            await tx.billing.update({
                where: { id: billing.id },
                data: {
                    cancellationReason: dto.reason ?? null,
                    cancellationRequestedAt: now,
                    cancellationEffectiveAt: schedule.effectiveDate ?? null
                }
            });
            this.txEventEmitter.emitAfterCommit(
                BillingEvents.SUBSCRIPTION_CANCELLED,
                new SubscriptionCancelledEvent(
                    billing.id,
                    billing.tenantId,
                    this.dateService.toISO(now),
                    schedule.effectiveDate ? this.dateService.toISO(schedule.effectiveDate) : this.dateService.toISO(now),
                    billing.stripeSubscriptionId ?? undefined,
                    billing.plan,
                    dto.reason ?? undefined,
                    userId ?? undefined
                )
            );
        });

        this.logger.log(`Subscription cancellation scheduled`, {
            tenantId: billing.tenantId,
            effectiveDate: schedule.effectiveDate,
            reason: dto.reason
        });

        return await this.getCurrentSubscription();
    }

    async reactivateSubscription(): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to reactivate for this tenant', HttpStatus.BAD_REQUEST);
        }

        const now = new Date();

        if (!billing.cancellationRequestedAt || !billing.cancellationEffectiveAt) {
            throw new HttpException('No pending cancellation to reactivate', HttpStatus.BAD_REQUEST);
        }

        if (billing.cancellationEffectiveAt <= now) {
            throw new HttpException('Cancellation is already effective and cannot be reactivated', HttpStatus.BAD_REQUEST);
        }

        await this.stripeService.reactivateSubscription(billing.stripeSubscriptionId);

        await this.prisma.billing.update({
            where: { id: billing.id },
            data: {
                cancellationReason: null,
                cancellationRequestedAt: null,
                cancellationEffectiveAt: null
            }
        });

        this.logger.log(`Subscription cancellation was reactivated`, {
            tenantId: billing.tenantId
        });

        return await this.getCurrentSubscription();
    }

    /**
     * A downgrade is refused while the tenant uses more than the target plan allows (seats, gauges such as
     * live campaigns, and this month's metered usage), listing each metric over the limit.
     */
    private async validateDowngradeUsageOrThrow(targetPlan: BillingPlanEnum): Promise<void> {
        const tenantId = this.tenantContext.getTenantId()!;
        const limits = (await this.planLimitService.limitsOfPlan(targetPlan)) ?? {};
        const overLimit: Array<{ metric: string; usage: number; limit: number }> = [];
        for (const [metric, limit] of Object.entries(limits)) {
            if (typeof limit !== 'number') {
                continue;
            }
            const usage = await this.planLimitService.usageOf(tenantId, metric);
            if (usage > limit) {
                overLimit.push({ metric, usage, limit });
            }
        }
        if (overLimit.length > 0) {
            throw new BaseException(
                'state_conflict',
                `Current usage exceeds the ${targetPlan} plan: ${overLimit.map((o) => `${o.metric} ${o.usage}/${o.limit}`).join(', ')}`,
                HttpStatus.CONFLICT,
                undefined,
                { overLimit }
            );
        }
    }

    async downgradeSubscription(targetPlan: BillingPlanEnum): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to downgrade for this tenant', HttpStatus.BAD_REQUEST);
        }

        if (billing.plan === targetPlan) {
            throw new HttpException('Target plan must be different from current plan', HttpStatus.BAD_REQUEST);
        }

        const planOrder = [BillingPlanEnum.FREE, BillingPlanEnum.STARTER, BillingPlanEnum.GROWTH, BillingPlanEnum.ENTERPRISE];

        const currentIndex = planOrder.indexOf(billing.plan as BillingPlanEnum);
        const targetIndex = planOrder.indexOf(targetPlan);

        if (currentIndex === -1 || targetIndex === -1) {
            throw new HttpException('Unsupported billing plan for downgrade', HttpStatus.BAD_REQUEST);
        }

        if (targetIndex >= currentIndex) {
            throw new HttpException('Target plan must be lower than current plan for downgrade', HttpStatus.BAD_REQUEST);
        }

        if (billing.pendingDowngradePlan) {
            throw new HttpException('There is already a pending downgrade scheduled for this subscription', HttpStatus.BAD_REQUEST);
        }

        await this.validateDowngradeUsageOrThrow(targetPlan);

        const previousPlan = billing.plan;
        const userId = this.tenantContext.getUserId();

        const schedule = await this.stripeService.scheduleSubscriptionDowngrade({
            stripeSubscriptionId: billing.stripeSubscriptionId,
            targetPlan
        });

        await this.prisma.$transaction(async (tx) => {
            await tx.billing.update({
                where: { id: billing.id },
                data: {
                    pendingDowngradePlan: targetPlan,
                    downgradeScheduledAt: schedule.effectiveDate ?? null
                }
            });
            this.txEventEmitter.emitAfterCommit(
                BillingEvents.SUBSCRIPTION_DOWNGRADE_SCHEDULED,
                new SubscriptionDowngradeScheduledEvent(
                    billing.id,
                    billing.tenantId,
                    previousPlan,
                    targetPlan,
                    schedule.effectiveDate ? this.dateService.toISO(schedule.effectiveDate) : this.dateService.nowISO(),
                    userId ?? undefined
                )
            );
        });

        this.logger.log(`Subscription downgrade scheduled from ${previousPlan} to ${targetPlan}`, {
            tenantId: billing.tenantId,
            previousPlan,
            targetPlan,
            effectiveDate: schedule.effectiveDate
        });

        return await this.getCurrentSubscription();
    }

    async cancelPendingDowngrade(): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to cancel downgrade for this tenant', HttpStatus.BAD_REQUEST);
        }

        if (!billing.pendingDowngradePlan) {
            throw new HttpException('No pending downgrade to cancel for this subscription', HttpStatus.BAD_REQUEST);
        }

        await this.stripeService.cancelPendingSubscriptionDowngrade(billing.stripeSubscriptionId);

        const previousPendingPlan = billing.pendingDowngradePlan;
        const previousScheduledAt = billing.downgradeScheduledAt;

        await this.prisma.billing.update({
            where: { id: billing.id },
            data: {
                pendingDowngradePlan: null,
                downgradeScheduledAt: null
            }
        });

        this.logger.log(`Pending subscription downgrade to plan ${previousPendingPlan} scheduled at ${previousScheduledAt} was cancelled`, {
            tenantId: billing.tenantId
        });

        return await this.getCurrentSubscription();
    }

    /**
     * Stops charging a tenant that is being deleted: ends the Stripe subscription now and drops the billing
     * record to a cancelled Free plan. Idempotent, so the deletion saga can retry it. The Stripe customer and
     * its invoices are kept, because invoices must be retained for accounting.
     */
    async closeForDeletion(tenantId: string): Promise<void> {
        const billing = await this.prisma.billing.findUnique({ where: { tenantId } });
        if (!billing || billing.deletedAt) {
            return;
        }
        if (billing.stripeSubscriptionId) {
            await this.stripeService.cancelSubscriptionNow(billing.stripeSubscriptionId);
        }
        const now = new Date();
        await this.prisma.$transaction(async (tx) => {
            await tx.billing.update({
                where: { id: billing.id },
                data: {
                    plan: BillingPlanEnum.FREE,
                    status: SubscriptionStatusEnum.CANCELED,
                    stripeSubscriptionId: null,
                    pendingDowngradePlan: null,
                    downgradeScheduledAt: null,
                    cancellationReason: 'tenant_deleted',
                    cancellationRequestedAt: billing.cancellationRequestedAt ?? now,
                    cancellationEffectiveAt: now,
                    deletedAt: now
                }
            });
            if (billing.stripeSubscriptionId) {
                this.txEventEmitter.emitAfterCommit(
                    BillingEvents.SUBSCRIPTION_CANCELLED,
                    new SubscriptionCancelledEvent(
                        billing.id,
                        tenantId,
                        this.dateService.toISO(now),
                        this.dateService.toISO(now),
                        billing.stripeSubscriptionId,
                        BillingPlanEnum.FREE,
                        'tenant_deleted'
                    )
                );
            }
        });
    }
}
