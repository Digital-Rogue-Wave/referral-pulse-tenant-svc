import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mock } from 'jest-mock-extended';
import moment from 'moment';

import { BillingPlanEnum } from '@common/enums/billing.enum';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';

import realInvoice from './__fixtures__/stripe-invoice.subscription-create.json';
import { StripeService } from './stripe.service';

const PRICES = { freePriceId: 'price_free', starterPriceId: 'price_starter', growthPriceId: 'price_growth', enterprisePriceId: 'price_ent' };
const PERIOD_END = 1_900_000_000;

describe('StripeService — Stripe operations', () => {
    let config: Record<string, unknown>;
    let stripe: Record<string, Record<string, jest.Mock | Record<string, jest.Mock>>>;
    let service: StripeService;

    const subscription = (overrides: Record<string, unknown> = {}) => ({
        id: 'sub_1',
        customer: 'cus_1',
        created: 1_700_000_000,
        schedule: null,
        items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_growth' }, current_period_end: PERIOD_END }] },
        ...overrides
    });

    beforeEach(() => {
        config = { 'stripeConfig.secretKey': 'sk_test_x', stripeConfig: { ...PRICES, webhookSecret: 'whsec_x' } };
        const cfg = mock<ConfigService>();
        cfg.get.mockImplementation((key: string) => config[key]);
        const dates = mock<DateService>();
        dates.fromUnix.mockImplementation((ts: number) => moment.unix(ts));
        dates.toISO.mockImplementation((d: Date) => d.toISOString());
        stripe = {
            subscriptions: { retrieve: jest.fn().mockResolvedValue(subscription()), update: jest.fn().mockResolvedValue(subscription()) },
            subscriptionSchedules: {
                retrieve: jest.fn().mockResolvedValue({ id: 'sched_1', phases: [{ start_date: 1_700_000_000 }] }),
                create: jest.fn().mockResolvedValue({ id: 'sched_1', phases: [] }),
                update: jest.fn(),
                release: jest.fn()
            },
            prices: { list: jest.fn() },
            invoices: { createPreview: jest.fn(), list: jest.fn() },
            charges: { retrieve: jest.fn() },
            setupIntents: { create: jest.fn().mockResolvedValue({ id: 'seti_1' }) },
            customers: { retrieve: jest.fn(), update: jest.fn() },
            paymentMethods: { list: jest.fn(), retrieve: jest.fn(), detach: jest.fn() },
            webhooks: { constructEvent: jest.fn().mockReturnValue({ id: 'evt_1' }) }
        };
        service = new StripeService(cfg as never, mock<AppLoggerService>(), dates, mock<TenantContextService>());
        Object.assign(service, { client: stripe });
    });

    it('maps a subscription’s price back to the plan', () => {
        const withPrice = (id: string) => ({ items: { data: [{ price: { id } }] } }) as never;
        expect(service.resolvePlanFromSubscription(withPrice('price_free'))).toBe(BillingPlanEnum.FREE);
        expect(service.resolvePlanFromSubscription(withPrice('price_starter'))).toBe(BillingPlanEnum.STARTER);
        expect(service.resolvePlanFromSubscription(withPrice('price_growth'))).toBe(BillingPlanEnum.GROWTH);
        expect(service.resolvePlanFromSubscription(withPrice('price_ent'))).toBe(BillingPlanEnum.ENTERPRISE);
        expect(service.resolvePlanFromSubscription(withPrice('price_other'))).toBeNull();
        expect(service.resolvePlanFromSubscription({ items: { data: [] } } as never)).toBeNull();
    });

    it('refuses a plan with no configured price', async () => {
        config['stripeConfig'] = {};
        config['stripeConfig.successUrl'] = 'https://app.example/billing/success';
        config['stripeConfig.cancelUrl'] = 'https://app.example/billing/cancel';
        await expect(service.createSubscriptionCheckoutSession({ tenantId: 't1', plan: BillingPlanEnum.STARTER })).rejects.toBeInstanceOf(
            HttpException
        );
    });

    it('fails fast without a secret key', async () => {
        Object.assign(service, { client: null });
        config['stripeConfig.secretKey'] = undefined;
        await expect(service.getSubscription('sub_1')).rejects.toThrow('Stripe secret key is not configured');
    });

    it('lists every active recurring price across pages', async () => {
        (stripe.prices!.list as jest.Mock)
            .mockResolvedValueOnce({ data: [{ id: 'p1' }], has_more: true })
            .mockResolvedValueOnce({ data: [{ id: 'p2' }], has_more: false });

        await expect(service.listActiveRecurringPricesWithProducts()).resolves.toEqual([{ id: 'p1' }, { id: 'p2' }]);
        expect((stripe.prices!.list as jest.Mock).mock.calls[1]![0]).toMatchObject({ starting_after: 'p1' });
    });

    it('verifies webhook signatures with the configured secret, and refuses without one', () => {
        expect(service.constructWebhookEvent('{}', 'sig')).toEqual({ id: 'evt_1' });
        expect(stripe.webhooks!.constructEvent).toHaveBeenCalledWith('{}', 'sig', 'whsec_x');
        config['stripeConfig'] = PRICES;
        expect(() => service.constructWebhookEvent('{}', 'sig')).toThrow(HttpException);
    });

    it('finds the customer of a charge, expanded or not', async () => {
        (stripe.charges!.retrieve as jest.Mock).mockResolvedValueOnce({ customer: 'cus_1' }).mockResolvedValueOnce({ customer: { id: 'cus_2' } });
        await expect(service.getChargeCustomerId('ch_1')).resolves.toBe('cus_1');
        await expect(service.getChargeCustomerId('ch_2')).resolves.toBe('cus_2');
    });

    it('maps invoices to our shape (amounts stay in minor units, as Stripe sends them)', async () => {
        (stripe.invoices!.list as jest.Mock).mockResolvedValue({
            has_more: false,
            data: [
                {
                    id: 'in_1',
                    number: 'A-1',
                    status: 'paid',
                    currency: 'eur',
                    amount_due: 4900,
                    amount_paid: 4900,
                    created: PERIOD_END,
                    period_start: PERIOD_END,
                    period_end: PERIOD_END
                }
            ]
        });
        const page = await service.listInvoicesForCustomer('cus_1', { limit: 10, endingBefore: 'in_0' });
        expect(page.data[0]).toMatchObject({
            id: 'in_1',
            amountDue: 4900,
            amountPaid: 4900,
            currency: 'eur',
            createdAt: new Date(PERIOD_END * 1000)
        });
        expect(stripe.invoices!.list).toHaveBeenCalledWith({ customer: 'cus_1', limit: 10, ending_before: 'in_0' });
    });

    it('maps a real first subscription invoice: cents kept, period taken from its lines, not from the invoice', async () => {
        (stripe.invoices!.list as jest.Mock).mockResolvedValue({ has_more: false, data: [realInvoice.invoice] });

        const page = await service.listInvoicesForCustomer('cus_fixture', { limit: 10 });

        expect(page.data[0]).toEqual({
            id: 'in_1UZxKOLbrWszeoGnIxfSMPV0',
            number: 'IIKWUNYT-0025',
            status: 'paid',
            currency: 'eur',
            amountDue: 1000,
            amountPaid: 1000,
            createdAt: new Date(1794249000 * 1000),
            periodStart: new Date(1794249000 * 1000),
            periodEnd: new Date(1796841000 * 1000),
            hostedInvoiceUrl: realInvoice.invoice.hosted_invoice_url,
            invoicePdfUrl: realInvoice.invoice.invoice_pdf
        });
    });
});
