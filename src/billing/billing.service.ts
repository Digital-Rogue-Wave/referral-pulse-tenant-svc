import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BillingEntity } from './billing.entity';
import { BillingPlanEnum, SubscriptionStatusEnum, PaymentStatusEnum } from '@mod/common/enums/billing.enum';
import { SubscriptionCheckoutResponseDto } from './dto/subscription-checkout-response.dto';
import { SubscriptionStatusDto } from './dto/subscription-status.dto';
import { SubscriptionUpgradePreviewResponseDto } from './dto/subscription-upgrade-preview-response.dto';
import { PaymentMethodSetupResponseDto } from './dto/payment-method-setup-response.dto';
import { PaymentMethodDto } from './dto/payment-method.dto';
import { SubscriptionCancelRequestDto } from './dto/subscription-cancel-request.dto';
import { InvoiceDto } from './dto/invoice.dto';
import { UpcomingInvoiceDto } from './dto/upcoming-invoice.dto';
import { StripeService } from './stripe.service';
import { ClsService } from 'nestjs-cls';
import type { ClsRequestContext } from '@domains/context/cls-request-context';
import Stripe from 'stripe';
import { EventIdempotencyService } from '@mod/common/idempotency/event-idempotency.service';
import { MonitoringService } from '@mod/common/monitoring/monitoring.service';
import { AuditService } from '@mod/common/audit/audit.service';
import { AuditAction } from '@mod/common/audit/audit-action.enum';
import { InjectTenantAwareRepository, TenantAwareRepository } from '@mod/common/tenant/tenant-aware.repository';
import { AgnosticTenantService } from '@mod/tenant/agnostic/agnostic-tenant.service';
import { TenantEntity } from '@mod/tenant/tenant.entity';
import { TenantStatsService } from '@mod/tenant/aware/tenant-stats.service';
import { TenantUsageEntity } from './tenant-usage.entity';
import { UsageSummaryDto, UsageMetricSummaryDto, UsageMetricHistoryPointDto } from './dto/usage-summary.dto';
import { In } from 'typeorm';
import {
    SubscriptionCreatedEvent,
    SubscriptionDowngradeScheduledEvent,
    SubscriptionUpgradedEvent,
    SubscriptionCancelledEvent,
    PaymentFailedEvent
} from '@mod/common/interfaces/billing-events.interface';

@Injectable()
export class BillingService {
    private readonly logger = new Logger(BillingService.name);
    constructor(
        @InjectTenantAwareRepository(BillingEntity)
        private readonly billingRepository: TenantAwareRepository<BillingEntity>,
        @InjectTenantAwareRepository(TenantUsageEntity)
        private readonly usageRepository: TenantAwareRepository<TenantUsageEntity>,
        private readonly eventEmitter: EventEmitter2,
        private readonly stripeService: StripeService,
        private readonly cls: ClsService<ClsRequestContext>,
        private readonly eventIdempotency: EventIdempotencyService,
        private readonly metrics: MonitoringService,
        private readonly auditService: AuditService,
        private readonly tenantService: AgnosticTenantService,
        private readonly tenantStatsService: TenantStatsService
    ) {}

    private async createBillingForTenant(): Promise<BillingEntity> {
        const tenantId = this.billingRepository.getTenantId();
        let billing = await this.billingRepository.findOne({ where: { tenantId } });
        if (!billing) {
            billing = this.billingRepository.createTenantContext({
                plan: BillingPlanEnum.FREE,
                status: SubscriptionStatusEnum.NONE
            });
            billing = await this.billingRepository.save(billing);
        }

        return billing;
    }

    async getUsageSummary(): Promise<UsageSummaryDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);

        const periodDates: string[] = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            periodDates.push(d.toISOString().slice(0, 10));
        }

        const rows = await this.usageRepository.find({
            where: { periodDate: In(periodDates) }
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

            entry.history.push({ periodDate: row.periodDate, usage: row.currentUsage });

            if (row.periodDate === todayStr) {
                entry.currentUsage = row.currentUsage;
            }
        }

        const metrics: UsageMetricSummaryDto[] = [];

        for (const [metricName, value] of metricsMap.entries()) {
            const limit: number | null = null;
            const percentageUsed: number | null = limit && limit > 0 ? Math.min((value.currentUsage / limit) * 100, 100) : null;

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
            plan: billing.plan,
            metrics
        };
    }

    private async handleInvoicePaymentSucceeded(event: Stripe.Event): Promise<void> {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceId = invoice.id;

        const rawInvoice = invoice as any;
        const paymentIntentId =
            typeof rawInvoice.payment_intent === 'string'
                ? rawInvoice.payment_intent
                : rawInvoice.payment_intent?.id;

        const subscriptionId =
            typeof rawInvoice.subscription === 'string'
                ? rawInvoice.subscription
                : rawInvoice.subscription?.id;

        if (!subscriptionId) {
            this.logger.warn(
                `invoice.payment_succeeded missing subscription reference: eventId=${event.id}, invoiceId=${invoiceId}`
            );
            return;
        }

        const billing = await this.billingRepository.manager.findOne(BillingEntity, {
            where: { stripeSubscriptionId: subscriptionId }
        });

        if (!billing) {
            this.logger.warn(
                `invoice.payment_succeeded: no BillingEntity found for subscriptionId=${subscriptionId}, eventId=${event.id}, invoiceId=${invoiceId}`
            );
            return;
        }

        if (paymentIntentId) {
            billing.stripeTransactionId = paymentIntentId;
            await this.billingRepository.manager.save(billing);
        }

        try {
            const tenant = await this.billingRepository.manager.findOne(TenantEntity, {
                where: { id: billing.tenantId }
            });

            if (!tenant) {
                this.logger.warn(
                    `invoice.payment_succeeded: no TenantEntity found for tenantId=${billing.tenantId}, eventId=${event.id}, invoiceId=${invoiceId}`
                );
            } else {
                if (tenant.paymentStatus !== PaymentStatusEnum.COMPLETED) {
                    tenant.paymentStatus = PaymentStatusEnum.COMPLETED;
                    await this.billingRepository.manager.save(tenant);
                }
            }
        } catch (err) {
            this.logger.error(
                `Failed to update tenant paymentStatus for invoice.payment_succeeded: tenantId=${billing.tenantId}, eventId=${event.id}, invoiceId=${invoiceId}`,
                err as Error
            );
        }

        this.logger.log(
            `Processed invoice.payment_succeeded from Stripe: eventId=${event.id}, invoiceId=${invoiceId}, subscriptionId=${subscriptionId}, paymentIntentId=${
                paymentIntentId ?? 'unknown'
            }`
        );
    }

    private async getOrCreateBillingForCurrentTenant(): Promise<BillingEntity> {
        return this.createBillingForTenant();
    }

    async subscriptionCheckout(plan: BillingPlanEnum, couponCode?: string): Promise<SubscriptionCheckoutResponseDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        const userId = this.cls.get('userId');

        const session = await this.stripeService.createSubscriptionCheckoutSession({
            tenantId: billing.tenantId,
            plan,
            userId,
            couponCode
        });

        this.logger.log(`Created Stripe Checkout Session ${session.id} via BillingService for tenant ${billing.tenantId}, plan ${plan}`);

        return {
            plan,
            checkoutUrl: session.url ?? undefined,
            sessionId: session.id,
            paymentStatus: PaymentStatusEnum.PENDING
        };
    }

    async getCurrentSubscription(): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();
        const tenantId = billing.tenantId;

        let paymentStatus: PaymentStatusEnum =
            billing.status === SubscriptionStatusEnum.ACTIVE
                ? PaymentStatusEnum.COMPLETED
                : billing.status === SubscriptionStatusEnum.CANCELED
                  ? PaymentStatusEnum.FAILED
                  : PaymentStatusEnum.PENDING;

        // Trial information from TenantEntity
        let trialActive: boolean | undefined;
        let trialEndsAt: Date | null = null;
        let trialDaysRemaining: number | null = null;

        try {
            const tenant = await this.tenantService.findOne(tenantId);
            if (tenant?.trialEndsAt) {
                trialEndsAt = tenant.trialEndsAt;
                const now = new Date();
                if (tenant.trialEndsAt > now) {
                    trialActive = true;
                    const diffMs = tenant.trialEndsAt.getTime() - now.getTime();
                    trialDaysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                } else {
                    trialActive = false;
                }

                if (tenant.paymentStatus) {
                    paymentStatus = tenant.paymentStatus;
                }
            } else {
                trialActive = false;
            }
        } catch (err) {
            this.logger.error(`Failed to load tenant trial info for tenant ${tenantId}`, err as Error);
        }

        // Usage summary via TenantStatsService
        let planUsagePercentage: number | null = null;
        try {
            const stats = await this.tenantStatsService.getStats(tenantId);
            planUsagePercentage = stats.planUsagePercentage ?? null;
        } catch (err) {
            this.logger.error(`Failed to load usage stats for tenant ${tenantId}`, err as Error);
        }

        // Live Stripe subscription details
        let stripeSubscriptionStatus: string | null = null;
        let stripeCurrentPeriodEnd: string | null = null;
        let stripeCancelAtPeriodEnd: boolean | null = null;

        if (billing.stripeSubscriptionId) {
            try {
                const subscription = await this.stripeService.getSubscription(billing.stripeSubscriptionId);
                stripeSubscriptionStatus = subscription.status;

                const rawSubscription = subscription as any;
                const endDate = new Date(rawSubscription.current_period_end * 1000);
                stripeCurrentPeriodEnd = endDate.toISOString();

                stripeCancelAtPeriodEnd = !!rawSubscription.cancel_at_period_end;
            } catch (err) {
                this.logger.error(`Failed to fetch Stripe subscription ${billing.stripeSubscriptionId} for tenant ${tenantId}`, err as Error);
            }
        }

        return {
            plan: billing.plan,
            subscriptionStatus: billing.status,
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
            stripeCancelAtPeriodEnd,
            pendingDowngradePlan: billing.pendingDowngradePlan ?? null,
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

        const userId = this.cls.get('userId');

        await this.stripeService.upgradeSubscription({
            stripeSubscriptionId: billing.stripeSubscriptionId,
            targetPlan
        });

        billing.plan = targetPlan;
        billing.status = SubscriptionStatusEnum.ACTIVE;

        await this.billingRepository.save(billing);

        const upgradedEvent: SubscriptionUpgradedEvent = {
            tenantId: billing.tenantId,
            previousPlan,
            billingPlan: billing.plan,
            subscriptionStatus: billing.status,
            stripeCustomerId: billing.stripeCustomerId ?? undefined,
            stripeSubscriptionId: billing.stripeSubscriptionId ?? undefined,
            upgradeUserId: userId ?? null
        };

        this.eventEmitter.emit('subscription.upgraded', upgradedEvent);

        await this.auditService.log({
            tenantId: billing.tenantId,
            action: AuditAction.SUBSCRIPTION_UPDATED,
            description: `Subscription upgraded from plan ${previousPlan} to ${billing.plan}`,
            metadata: {
                previousPlan,
                previousStatus,
                plan: billing.plan,
                status: billing.status,
                stripeCustomerId: billing.stripeCustomerId,
                stripeSubscriptionId: billing.stripeSubscriptionId
            }
        });

        return await this.getCurrentSubscription();
    }

    async createPaymentMethodSetupIntent(): Promise<PaymentMethodSetupResponseDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException('No Stripe customer configured for this tenant', HttpStatus.BAD_REQUEST);
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
            throw new HttpException('No Stripe customer configured for this tenant', HttpStatus.BAD_REQUEST);
        }

        const methods = await this.stripeService.listPaymentMethods(billing.stripeCustomerId);

        return methods;
    }

    async deletePaymentMethod(paymentMethodId: string): Promise<void> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException('No Stripe customer configured for this tenant', HttpStatus.BAD_REQUEST);
        }

        await this.stripeService.detachPaymentMethodForCustomer(billing.stripeCustomerId, paymentMethodId);
    }

    async setDefaultPaymentMethod(paymentMethodId: string): Promise<void> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException('No Stripe customer configured for this tenant', HttpStatus.BAD_REQUEST);
        }

        await this.stripeService.setDefaultPaymentMethodForCustomer(billing.stripeCustomerId, paymentMethodId);
    }

    async listInvoices(): Promise<InvoiceDto[]> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId) {
            throw new HttpException('No Stripe customer configured for this tenant', HttpStatus.BAD_REQUEST);
        }

        const invoices = await this.stripeService.listInvoicesForCustomer(billing.stripeCustomerId);

        return invoices;
    }

    async getUpcomingInvoice(): Promise<UpcomingInvoiceDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeCustomerId || !billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to preview upcoming invoice for this tenant', HttpStatus.BAD_REQUEST);
        }

        const upcoming = await this.stripeService.retrieveUpcomingInvoiceForCustomer({
            customerId: billing.stripeCustomerId,
            subscriptionId: billing.stripeSubscriptionId
        });

        return upcoming;
    }

    async cancelSubscription(dto: SubscriptionCancelRequestDto): Promise<SubscriptionStatusDto> {
        const billing = await this.getOrCreateBillingForCurrentTenant();

        if (!billing.stripeSubscriptionId) {
            throw new HttpException('No active subscription to cancel for this tenant', HttpStatus.BAD_REQUEST);
        }

        if (billing.status !== SubscriptionStatusEnum.ACTIVE) {
            throw new HttpException('Only active subscriptions can be cancelled', HttpStatus.BAD_REQUEST);
        }

        const now = new Date();

        if (billing.cancellationRequestedAt && billing.cancellationEffectiveAt && billing.cancellationEffectiveAt > now) {
            throw new HttpException('Subscription cancellation is already scheduled', HttpStatus.BAD_REQUEST);
        }

        const userId = this.cls.get('userId');

        const schedule = await this.stripeService.scheduleSubscriptionCancellation(billing.stripeSubscriptionId);

        billing.cancellationReason = dto.reason ?? null;
        billing.cancellationRequestedAt = now;
        billing.cancellationEffectiveAt = schedule.effectiveDate ?? null;

        await this.billingRepository.save(billing);

        const cancelledEvent: SubscriptionCancelledEvent = {
            tenantId: billing.tenantId,
            previousPlan: billing.plan,
            billingPlan: billing.plan,
            subscriptionStatus: billing.status,
            stripeCustomerId: billing.stripeCustomerId ?? undefined,
            stripeSubscriptionId: billing.stripeSubscriptionId ?? undefined,
            cancelUserId: userId ?? null,
            cancellationReason: billing.cancellationReason ?? null,
            cancellationEffectiveDate: billing.cancellationEffectiveAt ? billing.cancellationEffectiveAt.toISOString() : null
        };

        this.eventEmitter.emit('subscription.cancelled', cancelledEvent);

        await this.auditService.log({
            tenantId: billing.tenantId,
            action: AuditAction.SUBSCRIPTION_CANCELLED,
            description: `Subscription cancellation scheduled to take effect at ${
                billing.cancellationEffectiveAt?.toISOString() ?? 'the end of the current period'
            }`,
            metadata: {
                plan: billing.plan,
                status: billing.status,
                cancellationReason: billing.cancellationReason,
                cancellationRequestedAt: billing.cancellationRequestedAt,
                cancellationEffectiveAt: billing.cancellationEffectiveAt,
                stripeCustomerId: billing.stripeCustomerId,
                stripeSubscriptionId: billing.stripeSubscriptionId,
                cancelUserId: userId ?? null
            }
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

        const previousRequestedAt = billing.cancellationRequestedAt;
        const previousEffectiveAt = billing.cancellationEffectiveAt;

        await this.stripeService.reactivateSubscription(billing.stripeSubscriptionId);

        billing.cancellationReason = null;
        billing.cancellationRequestedAt = null;
        billing.cancellationEffectiveAt = null;

        await this.billingRepository.save(billing);

        await this.auditService.log({
            tenantId: billing.tenantId,
            action: AuditAction.SUBSCRIPTION_UPDATED,
            description: `Subscription cancellation scheduled at ${previousEffectiveAt?.toISOString()} was reactivated`,
            metadata: {
                plan: billing.plan,
                status: billing.status,
                previousCancellationRequestedAt: previousRequestedAt,
                previousCancellationEffectiveAt: previousEffectiveAt,
                stripeCustomerId: billing.stripeCustomerId,
                stripeSubscriptionId: billing.stripeSubscriptionId
            }
        });

        return await this.getCurrentSubscription();
    }

    private async validateDowngradeUsageOrThrow(targetPlan: BillingPlanEnum): Promise<void> {
        const tenantId = this.billingRepository.getTenantId();

        try {
            const stats = await this.tenantStatsService.getStats(tenantId);
            const usage = stats.planUsagePercentage ?? null;

            this.logger.log(
                `Downgrade usage validation placeholder for tenant ${tenantId}, targetPlan=${targetPlan}, planUsagePercentage=${usage ?? 'unknown'}`
            );
        } catch (err) {
            this.logger.error(`Failed to perform downgrade usage validation for tenant ${tenantId} and plan ${targetPlan}`, err as Error);
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

        const currentIndex = planOrder.indexOf(billing.plan);
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
        const previousStatus = billing.status;

        const userId = this.cls.get('userId');

        const schedule = await this.stripeService.scheduleSubscriptionDowngrade({
            stripeSubscriptionId: billing.stripeSubscriptionId,
            targetPlan
        });

        billing.pendingDowngradePlan = targetPlan;
        billing.downgradeScheduledAt = schedule.effectiveDate ?? null;

        await this.billingRepository.save(billing);

        const downgradeEvent: SubscriptionDowngradeScheduledEvent = {
            tenantId: billing.tenantId,
            previousPlan,
            billingPlan: targetPlan,
            subscriptionStatus: billing.status,
            stripeCustomerId: billing.stripeCustomerId ?? undefined,
            stripeSubscriptionId: billing.stripeSubscriptionId ?? undefined,
            downgradeUserId: userId ?? null,
            effectiveDate: schedule.effectiveDate ? schedule.effectiveDate.toISOString() : null
        };

        this.eventEmitter.emit('subscription.downgrade_scheduled', downgradeEvent);

        await this.auditService.log({
            tenantId: billing.tenantId,
            action: AuditAction.SUBSCRIPTION_DOWNGRADE_SCHEDULED,
            description: `Subscription downgrade scheduled from plan ${previousPlan} to ${targetPlan}`,
            metadata: {
                previousPlan,
                previousStatus,
                plan: billing.plan,
                status: billing.status,
                pendingDowngradePlan: billing.pendingDowngradePlan,
                downgradeScheduledAt: billing.downgradeScheduledAt,
                stripeCustomerId: billing.stripeCustomerId,
                stripeSubscriptionId: billing.stripeSubscriptionId
            }
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

        billing.pendingDowngradePlan = null;
        billing.downgradeScheduledAt = null;

        await this.billingRepository.save(billing);

        await this.auditService.log({
            tenantId: billing.tenantId,
            action: AuditAction.SUBSCRIPTION_UPDATED,
            description: `Pending subscription downgrade to plan ${previousPendingPlan} scheduled at ${previousScheduledAt} was cancelled`,
            metadata: {
                plan: billing.plan,
                status: billing.status,
                previousPendingDowngradePlan: previousPendingPlan,
                previousDowngradeScheduledAt: previousScheduledAt,
                stripeCustomerId: billing.stripeCustomerId,
                stripeSubscriptionId: billing.stripeSubscriptionId
            }
        });

        return await this.getCurrentSubscription();
    }

    async handleStripeWebhook(rawBody: Buffer | string, signature: string): Promise<void> {
        let event: Stripe.Event;
        try {
            event = this.stripeService.constructWebhookEvent(rawBody, signature);
        } catch (err) {
            this.logger.error('Failed to construct Stripe webhook event', err as Error);
            this.metrics.incCounter('billing_subscription_events_total', { event: 'unknown', result: 'error' });
            throw err;
        }

        const eventId = event.id;
        const consumerName = 'stripe-webhook';

        this.logger.log(`Received Stripe webhook event ${event.type} (id=${eventId})`);

        if (eventId) {
            const alreadyProcessed = await this.eventIdempotency.isProcessed(eventId, consumerName);
            if (alreadyProcessed) {
                this.logger.warn(`Stripe webhook event already processed - eventId: ${eventId}, type: ${event.type}, consumerName: ${consumerName}`);
                this.metrics.incCounter('billing_subscription_events_total', { event: event.type, result: 'duplicate' });
                return;
            }
        }

        let result: 'ok' | 'error' = 'ok';

        try {
            switch (event.type) {
                case 'checkout.session.completed': {
                    await this.handleCheckoutSessionCompleted(event);
                    break;
                }
                case 'invoice.payment_succeeded':
                case 'invoice.paid': {
                    await this.handleInvoicePaymentSucceeded(event);
                    break;
                }
                case 'invoice.payment_failed': {
                    await this.handleInvoicePaymentFailed(event);
                    break;
                }
                case 'customer.subscription.deleted': {
                    await this.handleCustomerSubscriptionDeleted(event);
                    break;
                }
                default:
                    this.logger.debug(`Ignoring unsupported Stripe event type: ${event.type}`);
            }
        } catch (err) {
            result = 'error';
            this.logger.error(`Error handling Stripe webhook event ${event.type} (id=${eventId ?? 'unknown'})`, err as Error);
            throw err;
        } finally {
            this.metrics.incCounter('billing_subscription_events_total', { event: event.type, result });

            if (eventId && result === 'ok') {
                await this.eventIdempotency.markProcessed(eventId, consumerName);
            }
        }
    }

    private async handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = session.metadata || {};
        const tenantId = metadata.tenantId as string | undefined;
        const planId = metadata.planId as BillingPlanEnum | undefined;
        const userId = metadata.userId as string | undefined;

        if (!tenantId || !planId) {
            this.logger.warn('Stripe checkout.session.completed missing tenantId or planId metadata');
            return;
        }

        this.cls.set('tenantId', tenantId);

        const billing = await this.createBillingForTenant();

        const previousPlan = billing.plan;
        const previousStatus = billing.status;
        const previousStripeCustomerId = billing.stripeCustomerId;
        const previousStripeSubscriptionId = billing.stripeSubscriptionId;

        if (planId === BillingPlanEnum.FREE) {
            billing.plan = BillingPlanEnum.FREE;
            billing.status = SubscriptionStatusEnum.NONE;
            billing.stripeCustomerId = (session.customer as string) ?? null;
            billing.stripeSubscriptionId = null;
            this.logger.log(
                `Processed checkout.session.completed for tenant ${tenantId}: plan=Free, status=None, customer=${billing.stripeCustomerId}`
            );
        } else {
            billing.plan = planId;
            billing.status = SubscriptionStatusEnum.ACTIVE;
            billing.stripeCustomerId = (session.customer as string) ?? null;
            billing.stripeSubscriptionId = (session.subscription as string) ?? null;
            this.logger.log(
                `Processed checkout.session.completed for tenant ${tenantId}: plan=${planId}, status=Active, customer=${billing.stripeCustomerId}, subscription=${billing.stripeSubscriptionId}`
            );
        }

        const rawSession = session as any;
        const paymentIntentId = typeof rawSession.payment_intent === 'string' ? rawSession.payment_intent : rawSession.payment_intent?.id;

        billing.stripeTransactionId = paymentIntentId ?? billing.stripeTransactionId ?? null;

        await this.billingRepository.save(billing);

        if (planId !== BillingPlanEnum.FREE) {
            await this.endTenantTrialIfActive(tenantId);
        }

        const isNewPaidSubscription =
            planId !== BillingPlanEnum.FREE &&
            billing.status === SubscriptionStatusEnum.ACTIVE &&
            (previousStatus !== SubscriptionStatusEnum.ACTIVE || !previousStripeSubscriptionId);

        if (isNewPaidSubscription) {
            const createdEvent: SubscriptionCreatedEvent = {
                tenantId: billing.tenantId,
                billingPlan: billing.plan,
                subscriptionStatus: billing.status,
                stripeCustomerId: billing.stripeCustomerId ?? undefined,
                stripeSubscriptionId: billing.stripeSubscriptionId ?? undefined,
                checkoutUserId: userId ?? null
            };

            this.eventEmitter.emit('subscription.created', createdEvent);
        }

        this.eventEmitter.emit('subscription.changed', {
            tenantId: billing.tenantId,
            billingPlan: billing.plan,
            subscriptionStatus: billing.status,
            stripeCustomerId: billing.stripeCustomerId,
            stripeSubscriptionId: billing.stripeSubscriptionId
        });

        await this.auditService.log({
            tenantId: billing.tenantId,
            action: AuditAction.SUBSCRIPTION_UPDATED,
            description: `Subscription updated via Stripe checkout to plan ${billing.plan} with status ${billing.status}`,
            metadata: {
                previousPlan,
                previousStatus,
                previousStripeCustomerId,
                previousStripeSubscriptionId,
                plan: billing.plan,
                status: billing.status,
                stripeCustomerId: billing.stripeCustomerId,
                stripeSubscriptionId: billing.stripeSubscriptionId,
                stripeEventId: event.id,
                stripeCheckoutSessionId: session.id,
                checkoutUserId: userId ?? null
            }
        });
    }

    private async handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceId = invoice.id;

        const rawInvoice = invoice as any;
        const paymentIntentId =
            typeof rawInvoice.payment_intent === 'string'
                ? rawInvoice.payment_intent
                : rawInvoice.payment_intent?.id;

        const subscriptionId =
            typeof rawInvoice.subscription === 'string'
                ? rawInvoice.subscription
                : rawInvoice.subscription?.id;

        const customerId =
            typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

        if (!subscriptionId && !customerId) {
            this.logger.warn(
                `invoice.payment_failed missing subscription/customer reference: eventId=${event.id}, invoiceId=${invoiceId}`
            );
            return;
        }

        let billing: BillingEntity | null = null;

        if (subscriptionId) {
            billing = await this.billingRepository.manager.findOne(BillingEntity, {
                where: { stripeSubscriptionId: subscriptionId }
            });
        }

        if (!billing && customerId) {
            billing = await this.billingRepository.manager.findOne(BillingEntity, {
                where: { stripeCustomerId: customerId }
            });
        }

        if (!billing) {
            this.logger.warn(
                `invoice.payment_failed: no BillingEntity found for subscriptionId=${subscriptionId ?? 'unknown'}, customerId=${
                    customerId ?? 'unknown'
                }, eventId=${event.id}, invoiceId=${invoiceId}`
            );
            return;
        }

        const nextAttempt = invoice.next_payment_attempt
            ? new Date(invoice.next_payment_attempt * 1000)
            : null;

        try {
            const tenant = await this.billingRepository.manager.findOne(TenantEntity, {
                where: { id: billing.tenantId }
            });

            if (!tenant) {
                this.logger.warn(
                    `invoice.payment_failed: no TenantEntity found for tenantId=${billing.tenantId}, eventId=${event.id}, invoiceId=${invoiceId}`
                );
            } else {
                if (nextAttempt && nextAttempt > new Date()) {
                    tenant.paymentStatus = PaymentStatusEnum.PENDING;
                    this.logger.warn(
                        `Set tenant ${tenant.id} paymentStatus=PENDING due to invoice.payment_failed within Stripe grace period (next_attempt=${nextAttempt.toISOString()})`
                    );
                } else {
                    tenant.paymentStatus = PaymentStatusEnum.FAILED;
                    this.logger.warn(
                        `Set tenant ${tenant.id} paymentStatus=FAILED due to invoice.payment_failed with no further automatic retries`
                    );
                }

                await this.billingRepository.manager.save(tenant);
            }
        } catch (err) {
            this.logger.error(
                `Failed to update tenant paymentStatus for invoice.payment_failed: tenantId=${billing.tenantId}, eventId=${event.id}, invoiceId=${invoiceId}`,
                err as Error
            );
        }

        this.logger.warn(
            `Processed invoice.payment_failed from Stripe: eventId=${event.id}, invoiceId=${invoiceId}, subscriptionId=${subscriptionId ?? 'unknown'}, customerId=${
                customerId ?? 'unknown'
            }, paymentIntentId=${paymentIntentId ?? 'unknown'}`
        );

        const paymentFailedEvent: PaymentFailedEvent = {
            tenantId: billing.tenantId,
            stripeCustomerId: billing.stripeCustomerId ?? undefined,
            stripeSubscriptionId: billing.stripeSubscriptionId ?? undefined,
            stripeInvoiceId: invoiceId
        };

        this.eventEmitter.emit('billing.payment_failed', paymentFailedEvent);
    }

    private async endTenantTrialIfActive(tenantId: string): Promise<void> {
        try {
            const tenant = await this.billingRepository.manager.findOne(TenantEntity, {
                where: { id: tenantId }
            });

            if (!tenant?.trialEndsAt) {
                return;
            }

            const now = new Date();

            if (tenant.trialEndsAt > now) {
                tenant.trialEndsAt = now;
                await this.billingRepository.manager.save(tenant);

                this.logger.log(`Ended trial early for tenant ${tenantId} at ${now.toISOString()} due to paid subscription checkout`);
            }
        } catch (err) {
            this.logger.error(`Failed to end trial early for tenant ${tenantId}`, err as Error);
        }
    }

    private async handleCustomerSubscriptionDeleted(event: Stripe.Event): Promise<void> {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;

        const billing = await this.billingRepository.manager.findOne(BillingEntity, {
            where: { stripeSubscriptionId: subscriptionId }
        });

        if (!billing) {
            this.logger.warn(`customer.subscription.deleted: no BillingEntity found for subscriptionId=${subscriptionId}, eventId=${event.id}`);
            return;
        }

        const previousPlan = billing.plan;
        const previousStatus = billing.status;

        const rawSubscription = subscription as any;
        const endedAt = rawSubscription.ended_at as number | undefined;
        const effectiveDate = endedAt ? new Date(endedAt * 1000) : new Date();

        billing.status = SubscriptionStatusEnum.CANCELED;
        billing.cancellationEffectiveAt = billing.cancellationEffectiveAt ?? effectiveDate;
        billing.stripeSubscriptionId = null;

        await this.billingRepository.manager.save(billing);

        this.logger.log(
            `Processed customer.subscription.deleted from Stripe: eventId=${event.id}, subscriptionId=${subscriptionId}, tenantId=${billing.tenantId}`
        );

        await this.auditService.log({
            tenantId: billing.tenantId,
            action: AuditAction.SUBSCRIPTION_UPDATED,
            description: `Stripe subscription ${subscriptionId} expired/cancelled; status updated to ${billing.status}`,
            metadata: {
                previousPlan,
                previousStatus,
                plan: billing.plan,
                status: billing.status,
                cancellationEffectiveAt: billing.cancellationEffectiveAt,
                stripeCustomerId: billing.stripeCustomerId,
                previousStripeSubscriptionId: subscriptionId,
                stripeEventId: event.id
            }
        });
    }
}
