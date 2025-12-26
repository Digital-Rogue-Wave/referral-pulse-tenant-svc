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
        const customerId =
            typeof rawSubscription.customer === 'string' ? rawSubscription.customer : rawSubscription.customer?.id;

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
        const nextInvoiceDate = upcoming.next_payment_attempt
            ? new Date(upcoming.next_payment_attempt * 1000)
            : null;

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
            proration_behavior: 'create_prorations',
            cancel_at_period_end: false
        });

        this.logger.log(
            `Upgraded Stripe subscription ${params.stripeSubscriptionId} to plan ${params.targetPlan} with proration`
        );
    }

    async scheduleSubscriptionDowngrade(params: {
        stripeSubscriptionId: string;
        targetPlan: BillingPlanEnum;
    }): Promise<{ effectiveDate: Date | null }> {
        const stripe = this.stripeClient();

        const subscription = await stripe.subscriptions.update(params.stripeSubscriptionId, {
            cancel_at_period_end: true
        });

        const rawSubscription = subscription as any;
        const periodEnd = rawSubscription.current_period_end
            ? new Date(rawSubscription.current_period_end * 1000)
            : null;

        this.logger.log(
            `Scheduled subscription downgrade for ${params.stripeSubscriptionId} to plan ${params.targetPlan} at period end ${
                periodEnd ? periodEnd.toISOString() : 'unknown'
            }`
        );

        return { effectiveDate: periodEnd };
    }

    async cancelPendingSubscriptionDowngrade(stripeSubscriptionId: string): Promise<void> {
        const stripe = this.stripeClient();

        await stripe.subscriptions.update(stripeSubscriptionId, {
            cancel_at_period_end: false
        });

        this.logger.log(
            `Canceled pending subscription downgrade (cancel_at_period_end=false) for Stripe subscription ${stripeSubscriptionId}`
        );
    }

    async scheduleSubscriptionCancellation(stripeSubscriptionId: string): Promise<{ effectiveDate: Date | null }> {
        const stripe = this.stripeClient();

        const subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
            cancel_at_period_end: true
        });

        const rawSubscription = subscription as any;
        const periodEnd = rawSubscription.current_period_end
            ? new Date(rawSubscription.current_period_end * 1000)
            : null;

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

        this.logger.log(
            `Reactivated Stripe subscription ${stripeSubscriptionId} by clearing cancel_at_period_end`
        );
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
}
