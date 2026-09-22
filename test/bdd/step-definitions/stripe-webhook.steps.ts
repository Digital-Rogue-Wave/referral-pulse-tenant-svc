/**
 * Stripe webhook steps: events are signed exactly as Stripe signs them and posted to the public
 * endpoint, so signature checking, the stripe_events ledger and the transactional apply all run for real.
 */

import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';

import type { BddWorldInterface } from '../support/world';
import { BDD_STRIPE_WEBHOOK_SECRET, stripeSdk } from '../support/stripe.fake';
import { fixturesPrisma } from '../support/db.fixtures';

interface StripeWebhookWorld extends BddWorldInterface {
    stripePayload?: string;
}

async function post(world: StripeWebhookWorld, signature: string): Promise<void> {
    world.response = await world
        .agent()
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(world.stripePayload!);
}

Given('Stripe event {string} was never received', async function (eventId: string) {
    await fixturesPrisma.stripeEvent.deleteMany({ where: { id: eventId } });
});

When(
    'Stripe delivers a signed {string} event {string} for subscription {string}',
    async function (this: StripeWebhookWorld, type: string, eventId: string, subscriptionId: string) {
        this.stripePayload = JSON.stringify({
            id: eventId,
            object: 'event',
            type,
            created: Math.floor(Date.now() / 1000),
            data: { object: { id: subscriptionId, object: 'subscription', ended_at: Math.floor(Date.now() / 1000) } }
        });
        await post(this, stripeSdk.webhooks.generateTestHeaderString({ payload: this.stripePayload, secret: BDD_STRIPE_WEBHOOK_SECRET }));
    }
);

When('Stripe delivers the same event again', async function (this: StripeWebhookWorld) {
    await post(this, stripeSdk.webhooks.generateTestHeaderString({ payload: this.stripePayload!, secret: BDD_STRIPE_WEBHOOK_SECRET }));
});

When('a Stripe event arrives with an invalid signature', async function (this: StripeWebhookWorld) {
    this.stripePayload = JSON.stringify({ id: 'evt_bdd_forged', object: 'event', type: 'invoice.paid', created: 0, data: { object: {} } });
    await post(this, 't=1,v1=forged');
});

Then('tenant {string} billing is on plan {string} with status {string}', async function (tenantId: string, plan: string, status: string) {
    const billing = await fixturesPrisma.billing.findUnique({ where: { tenantId } });
    assert.equal(billing?.plan, plan);
    assert.equal(billing?.status, status);
});

Then('Stripe event {string} is recorded as {string}', async function (eventId: string, status: string) {
    const row = await fixturesPrisma.stripeEvent.findUnique({ where: { id: eventId } });
    assert.equal(row?.status, status);
});

Then('Stripe event {string} was applied exactly once', async function (eventId: string) {
    const row = await fixturesPrisma.stripeEvent.findUnique({ where: { id: eventId } });
    assert.equal(row?.status, 'processed');
    assert.equal(row?.attempts, 1);
});

Then('Stripe event {string} is not recorded', async function (eventId: string) {
    assert.equal(await fixturesPrisma.stripeEvent.count({ where: { id: eventId } }), 0);
});
