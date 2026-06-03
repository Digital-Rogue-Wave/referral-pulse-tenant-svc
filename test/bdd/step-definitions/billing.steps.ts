/**
 * Billing Step Definitions
 *
 * Stripe is mocked per-scenario using one-shot nock interceptors
 * so that each checkout scenario gets a clean, predictable response.
 */

import { Given } from '@cucumber/cucumber';
import nock from 'nock';
import type { BddWorldInterface } from '../support/world';

Given(
    'the Stripe checkout API is mocked to return a checkout URL',
    function (this: BddWorldInterface) {
        // One-shot interceptors — they fire once then expire
        nock('https://api.stripe.com')
            .post('/v1/customers')
            .once()
            .reply(200, {
                id: 'cus_bdd_test',
                object: 'customer',
            });

        nock('https://api.stripe.com')
            .post('/v1/checkout/sessions')
            .once()
            .reply(200, {
                id: 'cs_bdd_test',
                object: 'checkout.session',
                url: 'https://checkout.stripe.com/pay/cs_bdd_test',
            });
    },
);
