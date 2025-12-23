import { Injectable, Logger } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { PlanService } from './plan.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlanEntity } from './plan.entity';
import type Stripe from 'stripe';
import { assertValidPlanLimits, type PlanLimits } from './plan-limits.type';

@Injectable()
export class PlanStripeSyncService {
    private readonly logger = new Logger(PlanStripeSyncService.name);

    constructor(
        private readonly stripeService: StripeService,
        private readonly planService: PlanService,
        @InjectRepository(PlanEntity)
        private readonly planRepository: Repository<PlanEntity>
    ) {}

    private buildLimitsFromMetadata(price: Stripe.Price, product: Stripe.Product | null): PlanLimits | null {
        const limitKeys: (keyof PlanLimits)[] = ['referred_users', 'campaigns', 'seats', 'leaderboard_entries', 'email_sends'];

        const limits: PlanLimits = {};

        for (const key of limitKeys) {
            const rawValue =
                (price.metadata && price.metadata[key as string]) ??
                (product && product.metadata ? product.metadata[key as string] : undefined);

            if (rawValue == null) {
                continue;
            }

            const num = Number(rawValue);
            if (!Number.isFinite(num) || num < 0) {
                this.logger.warn(
                    `Ignoring invalid limit value for key "${String(
                        key
                    )}" on Stripe price ${price.id}: rawValue=${rawValue}`
                );
                continue;
            }

            limits[key] = num;
        }

        if (Object.keys(limits).length === 0) {
            return null;
        }

        assertValidPlanLimits(limits);

        return limits;
    }

    private buildMetadataSnapshot(price: Stripe.Price, product: Stripe.Product | null): Record<string, any> | null {
        const metadata: Record<string, any> = {
            priceMetadata: { ...price.metadata }
        };

        if (product) {
            metadata.productMetadata = { ...product.metadata };
        }

        return Object.keys(metadata.priceMetadata || {}).length > 0 ||
            (metadata.productMetadata && Object.keys(metadata.productMetadata).length > 0)
            ? metadata
            : null;
    }

    private getActiveProduct(price: Stripe.Price): Stripe.Product | null {
        const product = price.product;

        if (!product || typeof product === 'string') {
            return null;
        }

        if ('deleted' in product && product.deleted) {
            return null;
        }

        return product;
    }

    async syncFromStripe(): Promise<void> {
        this.logger.log('Starting Stripe Products/Prices sync for plans');

        let prices: Stripe.Price[];
        try {
            prices = await this.stripeService.listActiveRecurringPricesWithProducts();
        } catch (error) {
            this.logger.warn(
                `Skipping Stripe Products/Prices sync because Stripe configuration or API is unavailable: ${
                    (error as Error).message
                }`
            );
            return;
        }

        const seenStripePriceIds = new Set<string>();

        for (const price of prices) {
            try {
                if (!price.active || price.type !== 'recurring') {
                    continue;
                }

                const product = this.getActiveProduct(price);

                const limits = this.buildLimitsFromMetadata(price, product);

                if (!limits) {
                    this.logger.debug(
                        `Skipping Stripe price ${price.id} because no recognized plan limit metadata was found; ` +
                            'add PlanLimits keys (referred_users, campaigns, seats, leaderboard_entries, email_sends) to Stripe metadata to include it.'
                    );
                    continue;
                }

                const metadata = this.buildMetadataSnapshot(price, product);

                const interval = price.recurring?.interval ?? null;

                const name =
                    (product && typeof product.name === 'string' && product.name.trim().length > 0
                        ? product.name.trim()
                        : undefined) ?? `Stripe price ${price.id}`;

                let plan = await this.planRepository.findOne({ where: { stripePriceId: price.id } });

                if (!plan) {
                    plan = this.planRepository.create({
                        name,
                        stripePriceId: price.id,
                        stripeProductId: product && typeof product.id === 'string' ? product.id : null,
                        interval,
                        limits: limits ?? null,
                        tenantId: null,
                        isActive: true,
                        manualInvoicing: false,
                        metadata: metadata ?? null
                    });
                } else {
                    plan.name = name;
                    plan.stripeProductId = product && typeof product.id === 'string' ? product.id : null;
                    plan.interval = interval;
                    plan.limits = limits ?? null;
                    plan.metadata = metadata ?? null;
                    plan.isActive = true;
                }

                await this.planRepository.save(plan);

                seenStripePriceIds.add(price.id);
            } catch (error) {
                this.logger.error(
                    `Failed to sync Stripe price ${price.id}: ${(error as Error).message}`,
                    (error as Error).stack
                );
            }
        }

        if (seenStripePriceIds.size > 0) {
            const existingPlans = await this.planRepository.find();

            for (const plan of existingPlans) {
                if (!plan.stripePriceId) continue;
                if (!seenStripePriceIds.has(plan.stripePriceId)) {
                    if (plan.isActive) {
                        this.logger.log(
                            `Marking plan ${plan.id} (stripePriceId=${plan.stripePriceId}) as inactive because it no longer exists in Stripe sync results`
                        );
                    }
                    plan.isActive = false;
                    await this.planRepository.save(plan);
                }
            }
        }

        await this.planService.invalidateCaches();

        this.logger.log('Completed Stripe Products/Prices sync for plans');
    }
}
