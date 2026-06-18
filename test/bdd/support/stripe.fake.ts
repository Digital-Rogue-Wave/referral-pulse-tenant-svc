/**
 * Fake StripeService for BDD.
 *
 * Stripe is a third-party external dependency reached over the network. The Stripe SDK's
 * default transport (fetch/undici) is not interceptable by nock, so instead of mocking HTTP
 * we override the StripeService provider at the test boundary with deterministic responses.
 * Only the methods exercised by the billing scenarios are implemented.
 */

import type { StripeService } from '../../../src/features/billing/stripe.service';

type FakeStripe = Pick<StripeService, 'createSubscriptionCheckoutSession' | 'previewSubscriptionUpgrade'>;

export const fakeStripeService: FakeStripe = {
    async createSubscriptionCheckoutSession() {
        return { id: 'cs_bdd_test', url: 'https://checkout.stripe.com/pay/cs_bdd_test' };
    },

    async previewSubscriptionUpgrade() {
        return { amountDueNow: 1234, currency: 'usd', nextInvoiceDate: new Date() };
    }
};
