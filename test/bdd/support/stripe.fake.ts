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

import type { StripeService } from '../../../src/features/billing/stripe.service';

type FakeStripe = Pick<
    StripeService,
    'createSubscriptionCheckoutSession' | 'previewSubscriptionUpgrade' | 'constructWebhookEvent' | 'resolvePlanFromSubscription'
>;

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

    resolvePlanFromSubscription() {
        return null;
    }
};
