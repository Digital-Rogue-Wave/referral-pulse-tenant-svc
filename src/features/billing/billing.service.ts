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
    InvoiceDto,
    UsageMetricSummaryDto,
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

    private async getOrCreateBillingForCurrentTenant(): Promise<Billing> {
        return this.createBillingForTenant();
    }

    /**
     * Opens a Stripe Checkout for a tenant with no live subscription (US1.8.2 F2): a second checkout would
     * start a second subscription and charge twice. Every later change (plan, cancellation) goes through the
     * Stripe-hosted portal (v5.2 API: `POST /v1/billing/portal-session`); the portal cannot start the first one.
     * Not in the v5.2 route list: kept as the only way from trial to paid (E1 P8 decision, 2026-11-23).
     */
    async subscriptionCheckout(plan: BillingPlanEnum, couponCode?: string): Promise<SubscriptionCheckoutResponseDto> {
        this.assertSelfServicePlan(plan);
        const billing = await this.getOrCreateBillingForCurrentTenant();
        if (billing.stripeSubscriptionId && LIVE_SUBSCRIPTION_STATUSES.includes(billing.status)) {
            throw new BaseException(
                'state_conflict',
                `This company already has a ${billing.plan} subscription; change it in the billing portal (POST /v1/billing/portal-session)`,
                HttpStatus.CONFLICT
            );
        }
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

        // v5.2 API: the plan answer carries the usage counters (live limits and current use, as other services see them).
        const usage = await this.usageCounters(tenantId);

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
            usage,
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

    /** One counter per metric the plan limits or the tenant uses: current use, the plan's limit, and the share used. */
    private async usageCounters(tenantId: string): Promise<UsageMetricSummaryDto[]> {
        const entitlements = await this.planLimitService.entitlementsOf(tenantId);
        const limits: Record<string, number | null> = entitlements?.limits ?? {};
        const used: Record<string, number> = entitlements?.usage ?? {};
        return [...new Set([...Object.keys(limits), ...Object.keys(used)])].sort().map((metric) => {
            const currentUsage = used[metric] ?? 0;
            const limit = limits[metric] ?? null;
            const percentageUsed = limit !== null && limit > 0 ? Math.min((currentUsage / limit) * 100, 100) : null;
            return { metric, currentUsage, limit, percentageUsed };
        });
    }

    /**
     * Free needs no checkout (leaving a paid plan is a cancellation), and Enterprise is sold by sales on a
     * tenant's own manual-invoicing plan (US1.8.2 F2, F6). Every self-service plan is monthly.
     */
    private assertSelfServicePlan(plan: BillingPlanEnum): void {
        if (plan === BillingPlanEnum.FREE) {
            throw new BaseException(
                'invalid_request',
                'Free needs no checkout; to leave a paid plan, cancel it in the billing portal (POST /v1/billing/portal-session)',
                HttpStatus.BAD_REQUEST,
                'plan'
            );
        }
        if (plan === BillingPlanEnum.ENTERPRISE) {
            throw new BaseException('invalid_request', 'Enterprise is sold by our sales team; contact sales', HttpStatus.BAD_REQUEST, 'plan');
        }
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
