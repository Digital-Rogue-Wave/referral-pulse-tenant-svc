import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mock } from 'jest-mock-extended';
import moment from 'moment';

import { BillingPlanEnum } from '@common/enums/billing.enum';
import { DateService } from '@common/helper/date.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';

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
        await expect(service.upgradeSubscription({ stripeSubscriptionId: 'sub_1', targetPlan: BillingPlanEnum.STARTER })).rejects.toBeInstanceOf(
            HttpException
        );
    });

    it('fails fast without a secret key', async () => {
        Object.assign(service, { client: null });
        config['stripeConfig.secretKey'] = undefined;
        await expect(service.getSubscription('sub_1')).rejects.toThrow('Stripe secret key is not configured');
    });

    it('previews an upgrade with the new price on the existing item', async () => {
        (stripe.invoices!.createPreview as jest.Mock).mockResolvedValue({ amount_due: 1500, currency: 'eur', next_payment_attempt: PERIOD_END });

        const preview = await service.previewSubscriptionUpgrade({ stripeSubscriptionId: 'sub_1', targetPlan: BillingPlanEnum.ENTERPRISE });

        expect(stripe.invoices!.createPreview).toHaveBeenCalledWith(
            expect.objectContaining({ customer: 'cus_1', subscription_details: { items: [{ id: 'si_1', price: 'price_ent' }] } })
        );
        expect(preview).toEqual({ amountDueNow: 15, currency: 'eur', nextInvoiceDate: new Date(PERIOD_END * 1000) });
    });

    it('refuses an upgrade preview for a subscription without customer or items', async () => {
        (stripe.subscriptions!.retrieve as jest.Mock).mockResolvedValueOnce(subscription({ customer: null }));
        await expect(
            service.previewSubscriptionUpgrade({ stripeSubscriptionId: 'sub_1', targetPlan: BillingPlanEnum.GROWTH })
        ).rejects.toBeInstanceOf(HttpException);
        (stripe.subscriptions!.retrieve as jest.Mock).mockResolvedValueOnce(subscription({ items: { data: [] } }));
        await expect(
            service.previewSubscriptionUpgrade({ stripeSubscriptionId: 'sub_1', targetPlan: BillingPlanEnum.GROWTH })
        ).rejects.toBeInstanceOf(HttpException);
    });

    it('schedules a downgrade as a second schedule phase starting at period end', async () => {
        const result = await service.scheduleSubscriptionDowngrade({ stripeSubscriptionId: 'sub_1', targetPlan: BillingPlanEnum.STARTER });

        expect(stripe.subscriptionSchedules!.create).toHaveBeenCalledWith({ from_subscription: 'sub_1' }, undefined);
        const [, params] = (stripe.subscriptionSchedules!.update as jest.Mock).mock.calls[0]!;
        expect(params.phases[1]).toEqual({ start_date: PERIOD_END, items: [{ price: 'price_starter', quantity: 1 }] });
        expect(result.effectiveDate).toEqual(new Date(PERIOD_END * 1000));
    });

    it('reuses an existing schedule, and skips scheduling without a period end', async () => {
        (stripe.subscriptions!.retrieve as jest.Mock).mockResolvedValueOnce(subscription({ schedule: 'sched_1' }));
        await service.scheduleSubscriptionDowngrade({ stripeSubscriptionId: 'sub_1', targetPlan: BillingPlanEnum.STARTER });
        expect(stripe.subscriptionSchedules!.retrieve).toHaveBeenCalledWith('sched_1');

        (stripe.subscriptions!.retrieve as jest.Mock).mockResolvedValueOnce(subscription({ items: { data: [{ id: 'si_1' }] } }));
        await expect(service.scheduleSubscriptionDowngrade({ stripeSubscriptionId: 'sub_1', targetPlan: BillingPlanEnum.STARTER })).resolves.toEqual({
            effectiveDate: null
        });
    });

    it('applies a scheduled downgrade without proration', async () => {
        await service.applyScheduledDowngrade({ stripeSubscriptionId: 'sub_1', targetPlan: BillingPlanEnum.STARTER });
        expect(stripe.subscriptions!.update).toHaveBeenCalledWith(
            'sub_1',
            expect.objectContaining({ items: [{ id: 'si_1', price: 'price_starter' }], proration_behavior: 'none' })
        );
        (stripe.subscriptions!.retrieve as jest.Mock).mockResolvedValueOnce(subscription({ items: { data: [] } }));
        await expect(service.applyScheduledDowngrade({ stripeSubscriptionId: 'sub_1', targetPlan: BillingPlanEnum.STARTER })).rejects.toBeInstanceOf(
            HttpException
        );
    });

    it('releases a pending downgrade schedule, and does nothing without one', async () => {
        (stripe.subscriptions!.retrieve as jest.Mock).mockResolvedValueOnce(subscription({ schedule: { id: 'sched_2' } }));
        await service.cancelPendingSubscriptionDowngrade('sub_1');
        expect(stripe.subscriptionSchedules!.release).toHaveBeenCalledWith('sched_2', {}, undefined);

        (stripe.subscriptionSchedules!.release as jest.Mock).mockClear();
        await service.cancelPendingSubscriptionDowngrade('sub_1');
        expect(stripe.subscriptionSchedules!.release).not.toHaveBeenCalled();
    });

    it('cancels at period end after releasing any schedule, and can reactivate', async () => {
        (stripe.subscriptions!.retrieve as jest.Mock).mockResolvedValueOnce(subscription({ schedule: 'sched_3' }));
        await expect(service.scheduleSubscriptionCancellation('sub_1')).resolves.toEqual({ effectiveDate: new Date(PERIOD_END * 1000) });
        expect(stripe.subscriptionSchedules!.release).toHaveBeenCalledWith('sched_3', {}, undefined);
        expect(stripe.subscriptions!.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true }, undefined);

        await service.reactivateSubscription('sub_1');
        expect(stripe.subscriptions!.update).toHaveBeenLastCalledWith('sub_1', { cancel_at_period_end: false }, undefined);
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

    describe('payment methods', () => {
        beforeEach(() => {
            (stripe.customers!.retrieve as jest.Mock).mockResolvedValue({ deleted: false, invoice_settings: { default_payment_method: 'pm_1' } });
            (stripe.paymentMethods!.list as jest.Mock).mockResolvedValue({
                data: [
                    { id: 'pm_1', card: { brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2030 } },
                    { id: 'pm_2', card: null }
                ]
            });
        });

        it('lists cards and marks the default', async () => {
            await expect(service.listPaymentMethods('cus_1')).resolves.toEqual([
                { id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 1, expYear: 2030, isDefault: true },
                { id: 'pm_2', brand: null, last4: null, expMonth: null, expYear: null, isDefault: false }
            ]);
        });

        it('creates a SetupIntent for off-session card collection', async () => {
            await service.createSetupIntent('cus_1');
            expect(stripe.setupIntents!.create).toHaveBeenCalledWith(
                { customer: 'cus_1', usage: 'off_session', payment_method_types: ['card'] },
                undefined
            );
        });

        it('detaches or sets as default only the tenant’s own cards', async () => {
            (stripe.paymentMethods!.retrieve as jest.Mock).mockResolvedValue({ customer: 'cus_1' });
            await service.detachPaymentMethodForCustomer('cus_1', 'pm_1');
            await service.setDefaultPaymentMethodForCustomer('cus_1', 'pm_1');
            expect(stripe.paymentMethods!.detach).toHaveBeenCalled();
            expect(stripe.customers!.update).toHaveBeenCalledWith('cus_1', { invoice_settings: { default_payment_method: 'pm_1' } }, undefined);

            (stripe.paymentMethods!.retrieve as jest.Mock).mockResolvedValue({ customer: { id: 'cus_other' } });
            await expect(service.detachPaymentMethodForCustomer('cus_1', 'pm_9')).rejects.toBeInstanceOf(HttpException);
            await expect(service.setDefaultPaymentMethodForCustomer('cus_1', 'pm_9')).rejects.toBeInstanceOf(HttpException);
        });
    });

    it('maps invoices and the upcoming invoice to our shape (amounts in major units)', async () => {
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
        expect(page.data[0]).toMatchObject({ id: 'in_1', amountDue: 49, amountPaid: 49, createdAt: new Date(PERIOD_END * 1000) });
        expect(stripe.invoices!.list).toHaveBeenCalledWith({ customer: 'cus_1', limit: 10, ending_before: 'in_0' });

        (stripe.invoices!.createPreview as jest.Mock).mockResolvedValue({ amount_due: 990, currency: 'eur', next_payment_attempt: null });
        await expect(service.retrieveUpcomingInvoiceForCustomer({ customerId: 'cus_1', subscriptionId: 'sub_1' })).resolves.toMatchObject({
            amountDue: 9.9,
            nextPaymentAttempt: null
        });
    });
});
