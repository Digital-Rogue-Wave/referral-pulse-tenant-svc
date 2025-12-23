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
    }): Promise<{ id: string; url: string | null }> {
        const stripe = this.stripeClient();

        const successUrl = this.configService.get('stripeConfig.successUrl', { infer: true });
        const cancelUrl = this.configService.get('stripeConfig.cancelUrl', { infer: true });

        if (!successUrl || !cancelUrl) {
            throw new HttpException('Stripe success/cancel URLs are not configured', HttpStatus.BAD_REQUEST);
        }

        const priceId = this.priceIdForPlan(params.plan);

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: {
                tenantId: params.tenantId,
                planId: params.plan
            }
        });

        this.logger.log(`Created Stripe Checkout Session ${session.id} for tenant ${params.tenantId}, plan ${params.plan}`);

        return { id: session.id, url: session.url };
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
