import { Injectable } from '@nestjs/common';
import type Stripe from 'stripe';

import { Prisma } from '@prisma-gen/generated/client';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { StripeService } from './stripe.service';
import { PlanService } from './plan.service';
import { assertValidPlanLimits, type PlanLimits } from './plan-limits.type';

@Injectable()
export class PlanStripeSyncService {
    constructor(
        private readonly prisma: DatabaseService,
        private readonly logger: AppLoggerService,
        private readonly stripeService: StripeService,
        private readonly planService: PlanService
    ) {
        this.logger.setContext(PlanStripeSyncService.name);
    }

    private buildLimitsFromMetadata(price: Stripe.Price, product: Stripe.Product | null): PlanLimits | null {
        const limitKeys: (keyof PlanLimits)[] = ['referred_users', 'campaigns', 'seats', 'leaderboard_entries', 'email_sends'];

        const limits: PlanLimits = {};

        for (const key of limitKeys) {
            const rawValue =
                (price.metadata && price.metadata[key as string]) ?? (product && product.metadata ? product.metadata[key as string] : undefined);

            if (rawValue === null) {
                continue;
            }

            const num = Number(rawValue);
            if (!Number.isFinite(num) || num < 0) {
                this.logger.warn(`Ignoring invalid limit value for key "${String(key)}" on Stripe price ${price.id}: rawValue=${rawValue}`);
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

    private buildMetadataSnapshot(price: Stripe.Price, product: Stripe.Product | null): Record<string, unknown> | null {
        const metadata: Record<string, unknown> = {
            priceMetadata: { ...price.metadata }
        };

        if (product) {
            metadata.productMetadata = { ...product.metadata };
        }

        return Object.keys((metadata.priceMetadata as object) || {}).length > 0 ||
            (metadata.productMetadata && Object.keys(metadata.productMetadata as object).length > 0)
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
            this.logger.warn(`Skipping Stripe Products/Prices sync because Stripe configuration or API is unavailable: ${(error as Error).message}`);
            return;
        }

        const seenStripePriceIds = new Set<string>();

        for (const price of prices) {
            const synced = await this.syncSinglePrice(price);
            if (synced) {
                seenStripePriceIds.add(price.id);
            }
        }

        await this.deactivateStalePlans(seenStripePriceIds);
        await this.planService.invalidateCaches();

        this.logger.log('Completed Stripe Products/Prices sync for plans');
    }

    private async syncSinglePrice(price: Stripe.Price): Promise<boolean> {
        try {
            if (!price.active || price.type !== 'recurring') {
                return false;
            }

            const product = this.getActiveProduct(price);
            const limits = this.buildLimitsFromMetadata(price, product);

            if (!limits) {
                this.logger.debug(
                    `Skipping Stripe price ${price.id} because no recognized plan limit metadata was found; ` +
                        'add PlanLimits keys (referred_users, campaigns, seats, leaderboard_entries, email_sends) to Stripe metadata to include it.'
                );
                return false;
            }

            const metadata = this.buildMetadataSnapshot(price, product);
            const interval = price.recurring?.interval ?? null;
            const name = this.resolvePlanName(price, product);
            const stripeProductId = product ? product.id : null;
            const limitsJson = (limits as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull;
            const metadataJson = (metadata as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull;

            const existing = await this.prisma.plan.findFirst({
                where: { stripePriceId: price.id, deletedAt: null }
            });

            if (!existing) {
                await this.prisma.plan.create({
                    data: {
                        name,
                        stripePriceId: price.id,
                        stripeProductId,
                        interval,
                        limits: limitsJson,
                        tenantId: null,
                        isActive: true,
                        manualInvoicing: false,
                        metadata: metadataJson
                    }
                });
            } else {
                await this.prisma.plan.update({
                    where: { id: existing.id },
                    data: {
                        name,
                        stripeProductId,
                        interval,
                        limits: limitsJson,
                        metadata: metadataJson,
                        isActive: true
                    }
                });
            }

            return true;
        } catch (error) {
            this.logger.error(`Failed to sync Stripe price ${price.id}: ${(error as Error).message}`, (error as Error).stack);
            return false;
        }
    }

    private resolvePlanName(price: Stripe.Price, product: Stripe.Product | null): string {
        if (product && product.name.trim().length > 0) {
            return product.name.trim();
        }
        return `Stripe price ${price.id}`;
    }

    private async deactivateStalePlans(seenStripePriceIds: Set<string>): Promise<void> {
        if (seenStripePriceIds.size === 0) {
            return;
        }

        const existingPlans = await this.prisma.plan.findMany({
            where: { deletedAt: null }
        });

        for (const plan of existingPlans) {
            if (!plan.stripePriceId || seenStripePriceIds.has(plan.stripePriceId)) {
                continue;
            }

            if (plan.isActive) {
                this.logger.log(
                    `Marking plan ${plan.id} (stripePriceId=${plan.stripePriceId}) as inactive because it no longer exists in Stripe sync results`
                );
            }

            await this.prisma.plan.update({
                where: { id: plan.id },
                data: { isActive: false }
            });
        }
    }
}
