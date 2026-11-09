/**
 * Fake StripeService for BDD.
 *
 * Stripe is a third-party external dependency reached over the network. The Stripe SDK's
 * default transport (fetch/undici) is not interceptable by nock, so instead of mocking HTTP
 * we override the StripeService provider at the test boundary with deterministic responses.
 * Webhook signatures are verified for real with the SDK (no network) and a BDD-only secret.
 * Only the methods exercised by the billing scenarios are implemented.
 */

import Stripe from 'stripe';

import { DateService } from '../../../src/common/helper/date.service';
import { StripeService } from '../../../src/features/billing/stripe.service';

type FakeStripe = Pick<
    StripeService,
    | 'createSubscriptionCheckoutSession'
    | 'previewSubscriptionUpgrade'
    | 'constructWebhookEvent'
    | 'resolvePlanFromSubscription'
    | 'getSubscription'
    | 'upgradeSubscription'
    | 'listInvoicesForCustomer'
    | 'retrieveUpcomingInvoiceForCustomer'
>;

/** BDD price ids, one per plan, so a subscription event can name the plan it moved to. */
export const BDD_PRICE_BY_PLAN: Record<string, string> = { Starter: 'price_bdd_starter', Growth: 'price_bdd_growth', Scale: 'price_bdd_scale' };

/** Set by a scenario to make the next upgrade fail the way Stripe refuses a card. Reset before each scenario. */
export const stripeBehaviour = { declineNextUpgrade: false, upgradeRequests: [] as Array<{ stripeSubscriptionId: string; targetPlan: string }> };

/**
 * Invoices as Stripe's API returns them (amounts in cents). Read by the real `StripeService` mapping below, so
 * the BDD proves our shape, not the fake's. A scenario sets them; reset before each scenario.
 */
export const stripeInvoices = { list: [] as Array<Record<string, unknown>>, upcoming: null as Record<string, unknown> | null };

const offlineStripeSdk = {
    invoices: {
        list: async (params: { limit: number }) => ({
            has_more: stripeInvoices.list.length > params.limit,
            data: stripeInvoices.list.slice(0, params.limit)
        }),
        createPreview: async () => stripeInvoices.upcoming
    }
};
const silentLogger = { setContext() {}, log() {}, warn() {}, error() {}, debug() {} };
/** The real StripeService over an offline SDK: only the invoice reads are routed to it. */
const realInvoiceReads = new StripeService({ get: () => undefined } as never, silentLogger as never, new DateService(), {} as never);
Object.assign(realInvoiceReads, { client: offlineStripeSdk });

/** Signs BDD webhook payloads; never a real Stripe secret. */
export const BDD_STRIPE_WEBHOOK_SECRET = 'whsec_bdd_only_not_a_real_secret';
export const stripeSdk = new Stripe('sk_test_bdd_offline');

export const fakeStripeService: FakeStripe = {
    async createSubscriptionCheckoutSession() {
        return { id: 'cs_bdd_test', url: 'https://checkout.stripe.com/pay/cs_bdd_test' };
    },

    async previewSubscriptionUpgrade() {
        return { amountDueNow: 1234, currency: 'usd', nextInvoiceDate: new Date() };
    },

    constructWebhookEvent(payload: Buffer | string, signature: string) {
        return stripeSdk.webhooks.constructEvent(payload, signature, BDD_STRIPE_WEBHOOK_SECRET);
    },

    resolvePlanFromSubscription(subscription: Stripe.Subscription) {
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const plan = Object.entries(BDD_PRICE_BY_PLAN).find(([, id]) => id === priceId)?.[0];
        return (plan ?? null) as never;
    },

    async getSubscription(id: string) {
        return { id, object: 'subscription', items: { data: [] } } as unknown as Stripe.Subscription;
    },

    async upgradeSubscription(params) {
        if (stripeBehaviour.declineNextUpgrade) {
            stripeBehaviour.declineNextUpgrade = false;
            throw Stripe.errors.StripeError.generate({ type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } as never);
        }
        stripeBehaviour.upgradeRequests.push(params);
    },

    listInvoicesForCustomer(customerId, page) {
        return realInvoiceReads.listInvoicesForCustomer(customerId, page);
    },

    retrieveUpcomingInvoiceForCustomer(params) {
        return realInvoiceReads.retrieveUpcomingInvoiceForCustomer(params);
    }
};
