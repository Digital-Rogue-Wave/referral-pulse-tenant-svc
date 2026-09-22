import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import { BillingPlanEnum } from '@common/enums/billing.enum';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';

import { StripeService } from './stripe.service';

const CONFIG: Record<string, unknown> = {
    'stripeConfig.secretKey': 'sk_test_x',
    'stripeConfig.successUrl': 'https://app.example/success',
    'stripeConfig.cancelUrl': 'https://app.example/cancel',
    'stripeConfig.automaticTax': true,
    'stripeConfig.portalReturnUrl': 'https://app.example/billing',
    stripeConfig: { starterPriceId: 'price_starter', growthPriceId: 'price_growth' }
};

describe('StripeService', () => {
    let context: MockProxy<TenantContextService>;
    let stripe: {
        checkout: { sessions: { create: jest.Mock } };
        subscriptions: { retrieve: jest.Mock; update: jest.Mock; cancel: jest.Mock };
        invoices: { list: jest.Mock };
        billingPortal: { sessions: { create: jest.Mock } };
    };
    let service: StripeService;

    beforeEach(() => {
        const config = mock<ConfigService>();
        config.get.mockImplementation((key: string) => CONFIG[key]);
        context = mock<TenantContextService>();
        context.getIdempotencyKey.mockReturnValue('req-key-1');
        stripe = {
            checkout: { sessions: { create: jest.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/x' }) } },
            subscriptions: {
                retrieve: jest.fn().mockResolvedValue({ id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1' }] } }),
                update: jest.fn().mockResolvedValue({ items: { data: [] } }),
                cancel: jest.fn()
            },
            invoices: { list: jest.fn().mockResolvedValue({ data: [], has_more: true }) },
            billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/p/x' }) } }
        };
        service = new StripeService(config as never, mock<AppLoggerService>(), mock<DateService>(), context);
        Object.assign(service, { client: stripe });
    });

    describe('checkout', () => {
        it('reuses the tenant’s Stripe customer and tags the subscription with the tenant', async () => {
            await service.createSubscriptionCheckoutSession({ tenantId: 't1', plan: BillingPlanEnum.STARTER, customerId: 'cus_1' });

            const [params] = stripe.checkout.sessions.create.mock.calls[0]!;
            expect(params).toMatchObject({
                customer: 'cus_1',
                client_reference_id: 't1',
                subscription_data: { metadata: { tenantId: 't1' } },
                line_items: [{ price: 'price_starter', quantity: 1 }]
            });
        });

        it('collects the billing address and tax ids and computes tax when Stripe Tax is on', async () => {
            await service.createSubscriptionCheckoutSession({ tenantId: 't1', plan: BillingPlanEnum.STARTER, customerId: 'cus_1' });

            expect(stripe.checkout.sessions.create.mock.calls[0]![0]).toMatchObject({
                automatic_tax: { enabled: true },
                tax_id_collection: { enabled: true },
                billing_address_collection: 'required',
                customer_update: { address: 'auto', name: 'auto' }
            });
        });

        it('sends an idempotency key derived from the request’s own Idempotency-Key', async () => {
            await service.createSubscriptionCheckoutSession({ tenantId: 't1', plan: BillingPlanEnum.STARTER });

            expect(stripe.checkout.sessions.create.mock.calls[0]![1]).toEqual({ idempotencyKey: 'checkout:t1:Starter:req-key-1' });
        });

        it('sends no key outside a request, leaving retries to the SDK', async () => {
            context.getIdempotencyKey.mockReturnValue(undefined);

            await service.createSubscriptionCheckoutSession({ tenantId: 't1', plan: BillingPlanEnum.STARTER });

            expect(stripe.checkout.sessions.create.mock.calls[0]![1]).toBeUndefined();
        });
    });

    it('scopes the upgrade key to the subscription, so a retried upgrade never invoices twice', async () => {
        await service.upgradeSubscription({ stripeSubscriptionId: 'sub_1', targetPlan: BillingPlanEnum.GROWTH });

        expect(stripe.subscriptions.update).toHaveBeenCalledWith(
            'sub_1',
            expect.objectContaining({ items: [{ id: 'si_1', price: 'price_growth' }], proration_behavior: 'always_invoice' }),
            { idempotencyKey: 'upgrade:sub_1:req-key-1' }
        );
    });

    it('does not cancel a subscription that already ended', async () => {
        stripe.subscriptions.retrieve.mockResolvedValue({ status: 'canceled' });

        await service.cancelSubscriptionNow('sub_1');

        expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    });

    it('pages invoices with Stripe’s cursors', async () => {
        const page = await service.listInvoicesForCustomer('cus_1', { limit: 25, startingAfter: 'in_9' });

        expect(stripe.invoices.list).toHaveBeenCalledWith({ customer: 'cus_1', limit: 25, starting_after: 'in_9' });
        expect(page.hasMore).toBe(true);
    });

    it('opens a Customer Portal session that returns to the dashboard', async () => {
        await expect(service.createPortalSession('cus_1')).resolves.toBe('https://billing.stripe.com/p/x');
        expect(stripe.billingPortal.sessions.create.mock.calls[0]![0]).toEqual({ customer: 'cus_1', return_url: 'https://app.example/billing' });
    });
});
