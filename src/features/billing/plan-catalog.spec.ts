import { BadRequestException } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';

import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { RedisKeyBuilder } from '@common/redis/redis-key.builder';
import { RedisService } from '@common/redis/redis.service';

import { PlanStripeSyncService } from './plan-stripe-sync.service';
import { PlanService } from './plan.service';
import { StripeService } from './stripe.service';

const PLAN = {
    id: 'p1',
    name: 'Growth',
    stripePriceId: 'price_growth',
    stripeProductId: 'prod_growth',
    interval: 'month',
    limits: { seats: 15 },
    tenantId: null,
    isActive: true,
    manualInvoicing: false,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null
};

describe('Plan catalog', () => {
    let prisma: { plan: Record<string, jest.Mock> };
    let redis: MockProxy<RedisService>;
    let plans: PlanService;

    beforeEach(() => {
        prisma = {
            plan: {
                create: jest.fn(async ({ data }) => ({ ...PLAN, ...data })),
                update: jest.fn(async ({ data }) => ({ ...PLAN, ...data })),
                findFirst: jest.fn().mockResolvedValue(PLAN),
                findMany: jest.fn().mockResolvedValue([PLAN])
            }
        };
        redis = mock<RedisService>();
        const keys = mock<RedisKeyBuilder>();
        keys.buildGlobalKey.mockReturnValue('billing-plans:public');
        plans = new PlanService(prisma as unknown as DatabaseService, mock<AppLoggerService>(), redis, keys);
    });

    describe('PlanService', () => {
        it('creates a plan with validated limits and drops the public cache', async () => {
            await expect(plans.create({ name: 'Scale', limits: { seats: 50 } } as never)).resolves.toMatchObject({ name: 'Scale' });
            expect(redis.del).toHaveBeenCalledWith('billing-plans:public', false);
        });

        it('refuses negative limits and a manual-invoicing plan without a tenant', async () => {
            await expect(plans.create({ name: 'Bad', limits: { seats: -1 } } as never)).rejects.toBeInstanceOf(BadRequestException);
            await expect(plans.create({ name: 'Manual', manualInvoicing: true } as never)).rejects.toBeInstanceOf(BadRequestException);
            await expect(plans.update('p1', { manualInvoicing: true } as never)).rejects.toBeInstanceOf(BadRequestException);
        });

        it('updates only the fields given', async () => {
            await plans.update('p1', {
                name: 'Growth+',
                stripePriceId: 'price_x',
                stripeProductId: 'prod_x',
                interval: 'year',
                limits: { seats: 20 },
                tenantId: 't1',
                isActive: true,
                manualInvoicing: true,
                metadata: { tier: 2 }
            } as never);

            expect(prisma.plan.update!.mock.calls[0]![0].data).toMatchObject({
                name: 'Growth+',
                interval: 'year',
                tenantId: 't1',
                manualInvoicing: true
            });
        });

        it('deactivates instead of deleting, and 400s an unknown plan', async () => {
            await plans.softDelete('p1');
            expect(prisma.plan.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isActive: false } });
            prisma.plan.findFirst!.mockResolvedValue(null);
            await expect(plans.softDelete('nope')).rejects.toBeInstanceOf(BadRequestException);
            await expect(plans.findOne({ id: 'nope' })).resolves.toBeNull();
        });

        it('serves the public catalog from cache, filling it on a miss', async () => {
            redis.get.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ name: 'cached' }] as never);
            await expect(plans.getPublicPlansCached()).resolves.toHaveLength(1);
            expect(redis.set).toHaveBeenCalledWith('billing-plans:public', expect.any(Array), { ttl: 3600, tenantScoped: false });
            await expect(plans.getPublicPlansCached()).resolves.toEqual([{ name: 'cached' }]);
        });

        it('pages the catalog and survives a cache outage on invalidation', async () => {
            await plans.findPage({ limit: 10 }, true);
            redis.del.mockRejectedValue(new Error('redis down'));
            await expect(plans.invalidateCaches()).resolves.toBeUndefined();
        });
    });

    describe('PlanStripeSyncService', () => {
        let stripe: MockProxy<StripeService>;
        let sync: PlanStripeSyncService;
        const price = (
            id: string,
            metadata: Record<string, string>,
            product: object | string | null = { id: 'prod_1', name: 'Growth', metadata: {} }
        ) => ({ id, active: true, type: 'recurring', recurring: { interval: 'month' }, metadata, product }) as never;

        beforeEach(() => {
            stripe = mock<StripeService>();
            sync = new PlanStripeSyncService(prisma as unknown as DatabaseService, mock<AppLoggerService>(), stripe, plans);
        });

        it('upserts a plan per Stripe price that declares limits, and deactivates plans gone from Stripe', async () => {
            prisma.plan.findFirst!.mockResolvedValueOnce(null).mockResolvedValueOnce(PLAN);
            prisma.plan.findMany!.mockResolvedValue([PLAN, { ...PLAN, id: 'p-old', stripePriceId: 'price_old' }]);
            stripe.listActiveRecurringPricesWithProducts.mockResolvedValue([
                price('price_new', { seats: '5', campaigns: 'lots' }),
                price('price_growth', { seats: '15' }, 'prod_ref'),
                price('price_nolimits', {})
            ]);

            await sync.syncFromStripe();

            expect(prisma.plan.create!.mock.calls[0]![0].data).toMatchObject({ name: 'Growth', stripePriceId: 'price_new', limits: { seats: 5 } });
            expect(prisma.plan.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 'p1' }, data: expect.objectContaining({ name: 'Stripe price price_growth' }) })
            );
            expect(prisma.plan.update).toHaveBeenCalledWith({ where: { id: 'p-old' }, data: { isActive: false } });
        });

        it('skips inactive or one-time prices and deleted products', async () => {
            stripe.listActiveRecurringPricesWithProducts.mockResolvedValue([
                { ...(price('p_inactive', { seats: '1' }) as object), active: false } as never,
                { ...(price('p_once', { seats: '1' }) as object), type: 'one_time' } as never,
                price('p_deleted', {}, { id: 'prod_d', deleted: true })
            ]);

            await sync.syncFromStripe();

            expect(prisma.plan.create).not.toHaveBeenCalled();
            expect(prisma.plan.findMany).not.toHaveBeenCalled();
        });

        it('leaves the catalog untouched when Stripe is unreachable', async () => {
            stripe.listActiveRecurringPricesWithProducts.mockRejectedValue(new Error('no key'));
            await sync.syncFromStripe();
            expect(prisma.plan.update).not.toHaveBeenCalled();
        });

        it('keeps syncing the other prices when one fails', async () => {
            prisma.plan.findFirst!.mockRejectedValueOnce(new Error('db blip')).mockResolvedValueOnce(null);
            stripe.listActiveRecurringPricesWithProducts.mockResolvedValue([price('a', { seats: '1' }), price('b', { seats: '2' })]);

            await sync.syncFromStripe();

            expect(prisma.plan.create).toHaveBeenCalledTimes(1);
        });
    });
});
