import { Injectable, Logger } from '@nestjs/common';
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

    private priceIdForPlan(plan: BillingPlanEnum): string {
        const cfg = this.configService.get('stripeConfig', { infer: true });

        switch (plan) {
            case BillingPlanEnum.STARTER:
                if (!cfg?.starterPriceId) throw new Error('Stripe Starter price ID is not configured');
                return cfg.starterPriceId;
            case BillingPlanEnum.GROWTH:
                if (!cfg?.growthPriceId) throw new Error('Stripe Growth price ID is not configured');
                return cfg.growthPriceId;
            case BillingPlanEnum.ENTERPRISE:
                if (!cfg?.enterprisePriceId) throw new Error('Stripe Enterprise price ID is not configured');
                return cfg.enterprisePriceId;
            default:
                throw new Error(`No Stripe price mapping for plan: ${plan}`);
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
            throw new Error('Stripe success/cancel URLs are not configured');
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
}
