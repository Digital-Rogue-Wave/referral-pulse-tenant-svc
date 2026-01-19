import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { AllConfigType } from '@mod/config/config.type';
import { BillingPlanEnum } from '@mod/common/enums/billing.enum';

@Injectable()
export class StripeService {
    private readonly logger = new Logger(StripeService.name);

    constructor(private readonly configService: ConfigService<AllConfigType>) {}

    private stripeClient(): Stripe {
        const secretKey = this.configService.get('stripeConfig.secretKey', { infer: true });
        if (!secretKey) {
            throw new Error('Stripe secret key is not configured');
        }
        return new Stripe(secretKey);
    }

    resolvePlanFromSubscription(subscription: Stripe.Subscription): BillingPlanEnum | null {
        const cfg = this.configService.get('stripeConfig', { infer: true });
        const items = subscription.items?.data ?? [];
        const firstItem = items[0];
        const priceId = firstItem?.price?.id ?? null;

        if (!priceId || !cfg) {
            return null;
        }

        if (cfg.freePriceId && priceId === cfg.freePriceId) return BillingPlanEnum.FREE;
        if (cfg.starterPriceId && priceId === cfg.starterPriceId) return BillingPlanEnum.STARTER;
        if (cfg.growthPriceId && priceId === cfg.growthPriceId) return BillingPlanEnum.GROWTH;
        if (cfg.enterprisePriceId && priceId === cfg.enterprisePriceId) return BillingPlanEnum.ENTERPRISE;

        return null;
    }

    async applyScheduledDowngrade(params: { stripeSubscriptionId: string; targetPlan: BillingPlanEnum }): Promise<void> {
        const stripe = this.stripeClient();

        const subscription = await stripe.subscriptions.retrieve(params.stripeSubscriptionId);

        const items = subscription.items?.data ?? [];
        const firstItem = items[0];

        if (!firstItem) {
            throw new HttpException('Stripe subscription has no items to downgrade', HttpStatus.BAD_REQUEST);
        }

        const newPriceId = this.priceIdForPlan(params.targetPlan);

        await stripe.subscriptions.update(params.stripeSubscriptionId, {
            items: [
                {
                    id: firstItem.id,
                    price: newPriceId
                }
            ],
            proration_behavior: 'none',
            cancel_at_period_end: false
        });

        this.logger.log(
            `Applied scheduled downgrade for Stripe subscription ${params.stripeSubscriptionId} to plan ${params.targetPlan} (no proration)`
        );
    }

    async listActiveRecurringPricesWithProducts(): Promise<Stripe.Price[]> {
        const stripe = this.stripeClient();

        const prices: Stripe.Price[] = [];
        let startingAfter: string | undefined;

        // Paginate through all active recurring prices, expanding the related product
        // to have enough information for local plan sync.
        // NOTE: This intentionally does not filter by specific product IDs; consumers
        // of this method are expected to apply any domain-specific filtering.
        // The method is defensive against Stripe pagination and can be safely reused
        // by background jobs or admin-triggered sync flows.
        // Stripe API returns up to 100 items per page.
        // See: https://docs.stripe.com/api/prices/list
        while (true) {
            const page = await stripe.prices.list({
                active: true,
                limit: 100,
                expand: ['data.product'],
                ...(startingAfter ? { starting_after: startingAfter } : {})
            });

            prices.push(...page.data);

            if (!page.has_more) {
                break;
            }

            const last = page.data[page.data.length - 1];
            if (!last) {
                break;
            }
            startingAfter = last.id;
        }

        this.logger.log(`Fetched ${prices.length} active recurring Stripe prices for plan sync`);

        return prices;
    }

    private priceIdForPlan(plan: BillingPlanEnum): string {
        const cfg = this.configService.get('stripeConfig', { infer: true });

        switch (plan) {
            case BillingPlanEnum.FREE:
                if (!cfg?.freePriceId) throw new HttpException('Stripe Free price ID is not configured', HttpStatus.BAD_REQUEST);
                return cfg.freePriceId;
            case BillingPlanEnum.STARTER:
                if (!cfg?.starterPriceId) throw new HttpException('Stripe Starter price ID is not configured', HttpStatus.BAD_REQUEST);
                return cfg.starterPriceId;
            case BillingPlanEnum.GROWTH:
                if (!cfg?.growthPriceId) throw new HttpException('Stripe Growth price ID is not configured', HttpStatus.BAD_REQUEST);
                return cfg.growthPriceId;
            case BillingPlanEnum.ENTERPRISE:
                if (!cfg?.enterprisePriceId) throw new HttpException('Stripe Enterprise price ID is not configured', HttpStatus.BAD_REQUEST);
                return cfg.enterprisePriceId;
            default:
                throw new HttpException(`No Stripe price mapping for plan: ${plan}`, HttpStatus.BAD_REQUEST);
        }
    }

    async createSubscriptionCheckoutSession(params: {
        tenantId: string;
        plan: BillingPlanEnum;
        userId?: string;
        couponCode?: string;
    }): Promise<{ id: string; url: string | null }> {
        const stripe = this.stripeClient();

        const successUrl = this.configService.get('stripeConfig.successUrl', { infer: true });
        const cancelUrl = this.configService.get('stripeConfig.cancelUrl', { infer: true });

        if (!successUrl || !cancelUrl) {
            throw new HttpException('Stripe success/cancel URLs are not configured', HttpStatus.BAD_REQUEST);
        }

        const priceId = this.priceIdForPlan(params.plan);

        let promotionCode: Stripe.PromotionCode | null = null;

        if (params.couponCode) {
            const promoList = await stripe.promotionCodes.list({
                code: params.couponCode,
                active: true,
                limit: 1
            });

            promotionCode = promoList.data[0] ?? null;

            if (!promotionCode) {
                throw new HttpException('Invalid or inactive coupon code', HttpStatus.BAD_REQUEST);
            }
        }

        const metadata: Record<string, string> = {
            tenantId: params.tenantId,
            planId: params.plan
        };

        if (params.userId) {
            metadata.userId = params.userId;
        }

        if (params.couponCode) {
            metadata.couponCode = params.couponCode;
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata,
            ...(promotionCode
                ? {
                      discounts: [
                          {
                              promotion_code: promotionCode.id
                          }
                      ]
                  }
                : {})
        });

        this.logger.log(`Created Stripe Checkout Session ${session.id} for tenant ${params.tenantId}, plan ${params.plan}`);

        return { id: session.id, url: session.url };
    }

    async getSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription> {
        const stripe = this.stripeClient();
        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        this.logger.log(`Fetched Stripe subscription ${stripeSubscriptionId}`);
        return subscription;
    }

    async previewSubscriptionUpgrade(params: {
        stripeSubscriptionId: string;
        targetPlan: BillingPlanEnum;
    }): Promise<{ amountDueNow: number; currency: string; nextInvoiceDate: Date | null }> {
        const stripe = this.stripeClient();

        const subscription = await stripe.subscriptions.retrieve(params.stripeSubscriptionId);

        const rawSubscription = subscription as any;
        const customerId = typeof rawSubscription.customer === 'string' ? rawSubscription.customer : rawSubscription.customer?.id;

        if (!customerId) {
            throw new HttpException('Stripe subscription is missing customer for upgrade preview', HttpStatus.BAD_REQUEST);
        }

        const items = subscription.items?.data ?? [];
        const firstItem = items[0];

        if (!firstItem) {
            throw new HttpException('Stripe subscription has no items for upgrade preview', HttpStatus.BAD_REQUEST);
        }

        const newPriceId = this.priceIdForPlan(params.targetPlan);

        const invoices = stripe.invoices as any;

        const upcoming = await invoices.retrieveUpcoming({
            customer: customerId,
            subscription: params.stripeSubscriptionId,
            subscription_items: [
                {
                    id: firstItem.id,
                    price: newPriceId
                }
            ]
        });

        const amountDueNow = (upcoming.amount_due ?? 0) / 100;
        const currency = upcoming.currency ?? 'usd';
        const nextInvoiceDate = upcoming.next_payment_attempt ? new Date(upcoming.next_payment_attempt * 1000) : null;

        this.logger.log(
            `Calculated Stripe subscription upgrade preview for subscription ${params.stripeSubscriptionId} to plan ${params.targetPlan}: amountDueNow=${amountDueNow} ${currency}`
        );

        return { amountDueNow, currency, nextInvoiceDate };
    }

    async upgradeSubscription(params: { stripeSubscriptionId: string; targetPlan: BillingPlanEnum }): Promise<void> {
        const stripe = this.stripeClient();

        const subscription = await stripe.subscriptions.retrieve(params.stripeSubscriptionId);

        const items = subscription.items?.data ?? [];
        const firstItem = items[0];

        if (!firstItem) {
            throw new HttpException('Stripe subscription has no items to upgrade', HttpStatus.BAD_REQUEST);
        }

        const newPriceId = this.priceIdForPlan(params.targetPlan);

        await stripe.subscriptions.update(params.stripeSubscriptionId, {
            items: [
                {
                    id: firstItem.id,
                    price: newPriceId
                }
            ],
            proration_behavior: 'always_invoice',
            payment_behavior: 'error_if_incomplete',
            cancel_at_period_end: false
        });

        this.logger.log(`Upgraded Stripe subscription ${params.stripeSubscriptionId} to plan ${params.targetPlan} with proration`);
    }

    async scheduleSubscriptionDowngrade(params: {
        stripeSubscriptionId: string;
        targetPlan: BillingPlanEnum;
    }): Promise<{ effectiveDate: Date | null }> {
        const stripe = this.stripeClient();

        const subscription = await stripe.subscriptions.retrieve(params.stripeSubscriptionId);
        const rawSubscription = subscription as any;
        const periodEndRaw = (rawSubscription.current_period_end ?? rawSubscription.items?.data?.[0]?.current_period_end) as unknown;
        const periodEndTs = typeof periodEndRaw === 'number' && Number.isFinite(periodEndRaw) ? periodEndRaw : null;
        const effectiveDate = periodEndTs ? new Date(periodEndTs * 1000) : null;

        if (!periodEndTs) {
            this.logger.warn(
                `Unable to schedule downgrade in Stripe because current_period_end is missing for subscription ${params.stripeSubscriptionId}`
            );
            return { effectiveDate: null };
        }

        const items = subscription.items?.data ?? [];
        const firstItem = items[0];

        if (!firstItem?.price?.id) {
            throw new HttpException('Stripe subscription has no price information to schedule downgrade', HttpStatus.BAD_REQUEST);
        }

        const currentPriceId = firstItem.price.id;
        const currentQuantity = firstItem.quantity ?? 1;
        const newPriceId = this.priceIdForPlan(params.targetPlan);

        const scheduleId = typeof rawSubscription.schedule === 'string' ? rawSubscription.schedule : rawSubscription.schedule?.id;

        const schedule = scheduleId
            ? await stripe.subscriptionSchedules.retrieve(scheduleId)
            : await stripe.subscriptionSchedules.create({ from_subscription: params.stripeSubscriptionId });

        const startDate = schedule.phases?.[0]?.start_date ?? rawSubscription.start_date ?? rawSubscription.created;

        await stripe.subscriptionSchedules.update(schedule.id, {
            end_behavior: 'release',
            phases: [
                {
                    start_date: startDate,
                    end_date: periodEndTs,
                    items: [{ price: currentPriceId, quantity: currentQuantity }]
                },
                {
                    start_date: periodEndTs,
                    items: [{ price: newPriceId, quantity: currentQuantity }]
                }
            ]
        });

        this.logger.log(
            `Scheduled Stripe subscription ${params.stripeSubscriptionId} to downgrade to plan ${params.targetPlan} at ${
                effectiveDate ? effectiveDate.toISOString() : 'unknown'
            } using schedule ${schedule.id}`
        );

        return { effectiveDate };
    }

    async cancelPendingSubscriptionDowngrade(stripeSubscriptionId: string): Promise<void> {
        const stripe = this.stripeClient();

        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        const rawSubscription = subscription as any;
        const scheduleId = typeof rawSubscription.schedule === 'string' ? rawSubscription.schedule : rawSubscription.schedule?.id;

        if (!scheduleId) {
            this.logger.log(`No Stripe schedule found to cancel downgrade for subscription ${stripeSubscriptionId}`);
            return;
        }

        await stripe.subscriptionSchedules.release(scheduleId);
        this.logger.log(`Released Stripe subscription schedule ${scheduleId} for subscription ${stripeSubscriptionId}`);
    }

    async scheduleSubscriptionCancellation(stripeSubscriptionId: string): Promise<{ effectiveDate: Date | null }> {
        const stripe = this.stripeClient();

        const existing = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        const rawExisting = existing as any;
        const existingScheduleId = typeof rawExisting.schedule === 'string' ? rawExisting.schedule : rawExisting.schedule?.id;

        if (existingScheduleId) {
            await stripe.subscriptionSchedules.release(existingScheduleId);
            this.logger.log(
                `Released Stripe subscription schedule ${existingScheduleId} before scheduling cancellation for subscription ${stripeSubscriptionId}`
            );
        }

        const subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
            cancel_at_period_end: true
        });

        const rawSubscription = subscription as any;
        const periodEndRaw = (rawSubscription.current_period_end ?? rawSubscription.items?.data?.[0]?.current_period_end) as unknown;
        const periodEndTs = typeof periodEndRaw === 'number' && Number.isFinite(periodEndRaw) ? periodEndRaw : null;
        const periodEnd = periodEndTs ? new Date(periodEndTs * 1000) : null;

        this.logger.log(
            `Scheduled subscription cancellation at period end for Stripe subscription ${stripeSubscriptionId} with effective date ${
                periodEnd ? periodEnd.toISOString() : 'unknown'
            }`
        );

        return { effectiveDate: periodEnd };
    }

    async reactivateSubscription(stripeSubscriptionId: string): Promise<void> {
        const stripe = this.stripeClient();

        await stripe.subscriptions.update(stripeSubscriptionId, {
            cancel_at_period_end: false
        });

        this.logger.log(`Reactivated Stripe subscription ${stripeSubscriptionId} by clearing cancel_at_period_end`);
    }

    async cancelSubscription(stripeSubscriptionId: string): Promise<void> {
        const stripe = this.stripeClient();
        await stripe.subscriptions.cancel(stripeSubscriptionId);
        this.logger.log(`Canceled Stripe subscription ${stripeSubscriptionId}`);
    }

    constructWebhookEvent(payload: Buffer | string, signature: string): Stripe.Event {
        const stripe = this.stripeClient();
        const cfg = this.configService.get('stripeConfig', { infer: true });
        const webhookSecret = cfg?.webhookSecret as string | undefined;
        if (!webhookSecret) {
            throw new HttpException('Stripe webhook secret is not configured', HttpStatus.BAD_REQUEST);
        }

        return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    }

    async createSetupIntent(customerId: string): Promise<Stripe.SetupIntent> {
        const stripe = this.stripeClient();

        const setupIntent = await stripe.setupIntents.create({
            customer: customerId,
            usage: 'off_session',
            payment_method_types: ['card']
        });

        this.logger.log(`Created Stripe SetupIntent ${setupIntent.id} for customer ${customerId}`);

        return setupIntent;
    }

    async listPaymentMethods(customerId: string): Promise<
        {
            id: string;
            brand: string | null;
            last4: string | null;
            expMonth: number | null;
            expYear: number | null;
            isDefault: boolean;
        }[]
    > {
        const stripe = this.stripeClient();

        const customer = await stripe.customers.retrieve(customerId);
        const rawCustomer = customer as any;
        const defaultPm = rawCustomer.invoice_settings?.default_payment_method;
        const defaultPaymentMethodId = typeof defaultPm === 'string' ? defaultPm : (defaultPm?.id ?? null);

        const list = await stripe.paymentMethods.list({
            customer: customerId,
            type: 'card',
            limit: 100
        });

        this.logger.log(`Listed ${list.data.length} Stripe payment methods for customer ${customerId}, default=${defaultPaymentMethodId ?? 'none'}`);

        return list.data.map((pm) => {
            const card = pm.card;
            return {
                id: pm.id,
                brand: card?.brand ?? null,
                last4: card?.last4 ?? null,
                expMonth: card?.exp_month ?? null,
                expYear: card?.exp_year ?? null,
                isDefault: pm.id === defaultPaymentMethodId
            };
        });
    }

    async detachPaymentMethodForCustomer(customerId: string, paymentMethodId: string): Promise<void> {
        const stripe = this.stripeClient();

        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
        const rawPm = pm as any;
        const pmCustomer = rawPm.customer;
        const pmCustomerId = typeof pmCustomer === 'string' ? pmCustomer : (pmCustomer?.id ?? null);

        if (pmCustomerId !== customerId) {
            throw new HttpException('Payment method not found for this customer', HttpStatus.NOT_FOUND);
        }

        await stripe.paymentMethods.detach(paymentMethodId);

        this.logger.log(`Detached Stripe payment method ${paymentMethodId} from customer ${customerId}`);
    }

    async setDefaultPaymentMethodForCustomer(customerId: string, paymentMethodId: string): Promise<void> {
        const stripe = this.stripeClient();

        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
        const rawPm = pm as any;
        const pmCustomer = rawPm.customer;
        const pmCustomerId = typeof pmCustomer === 'string' ? pmCustomer : (pmCustomer?.id ?? null);

        if (pmCustomerId !== customerId) {
            throw new HttpException('Payment method not found for this customer', HttpStatus.NOT_FOUND);
        }

        await stripe.customers.update(customerId, {
            invoice_settings: {
                default_payment_method: paymentMethodId
            }
        });

        this.logger.log(`Set default payment method ${paymentMethodId} for customer ${customerId}`);
    }

    async listInvoicesForCustomer(customerId: string): Promise<
        {
            id: string;
            number: string | null;
            status: string | null;
            currency: string;
            amountDue: number;
            amountPaid: number;
            createdAt: Date;
            periodStart: Date | null;
            periodEnd: Date | null;
            hostedInvoiceUrl: string | null;
            invoicePdfUrl: string | null;
        }[]
    > {
        const stripe = this.stripeClient();

        const list = await stripe.invoices.list({
            customer: customerId,
            limit: 100
        });

        this.logger.log(`Listed ${list.data.length} Stripe invoices for customer ${customerId}`);

        return list.data.map((invoice) => {
            const createdTs = invoice.created ?? 0;
            const periodStartTs = (invoice as any).period_start as number | undefined;
            const periodEndTs = (invoice as any).period_end as number | undefined;

            return {
                id: invoice.id,
                number: invoice.number ?? null,
                status: invoice.status ?? null,
                currency: invoice.currency ?? 'usd',
                amountDue: (invoice.amount_due ?? 0) / 100,
                amountPaid: (invoice.amount_paid ?? 0) / 100,
                createdAt: new Date(createdTs * 1000),
                periodStart: periodStartTs ? new Date(periodStartTs * 1000) : null,
                periodEnd: periodEndTs ? new Date(periodEndTs * 1000) : null,
                hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
                invoicePdfUrl: invoice.invoice_pdf ?? null
            };
        });
    }

    async retrieveUpcomingInvoiceForCustomer(params: { customerId: string; subscriptionId?: string | null }): Promise<{
        amountDue: number;
        currency: string;
        nextPaymentAttempt: Date | null;
        periodStart: Date | null;
        periodEnd: Date | null;
    }> {
        const stripe = this.stripeClient();

        const invoices = stripe.invoices as any;

        const upcoming = await invoices.retrieveUpcoming({
            customer: params.customerId,
            ...(params.subscriptionId
                ? {
                      subscription: params.subscriptionId
                  }
                : {})
        });

        const amountDue = (upcoming.amount_due ?? 0) / 100;
        const currency = upcoming.currency ?? 'usd';

        const nextPaymentAttempt = upcoming.next_payment_attempt ? new Date(upcoming.next_payment_attempt * 1000) : null;

        const periodStartTs = (upcoming as any).period_start as number | undefined;
        const periodEndTs = (upcoming as any).period_end as number | undefined;

        const periodStart = periodStartTs ? new Date(periodStartTs * 1000) : null;
        const periodEnd = periodEndTs ? new Date(periodEndTs * 1000) : null;

        this.logger.log(
            `Retrieved upcoming Stripe invoice preview for customer ${params.customerId} (subscription=${
                params.subscriptionId ?? 'none'
            }): amountDue=${amountDue} ${currency}`
        );

        return {
            amountDue,
            currency,
            nextPaymentAttempt,
            periodStart,
            periodEnd
        };
    }
}
