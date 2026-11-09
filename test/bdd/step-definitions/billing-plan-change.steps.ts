/**
 * Changing the plan through Stripe (US1.8.2). Reuses the signed-up company of `billing-plan.steps.ts`
 * (same Before/After clean-up). The company is put on a paid plan straight in the database, as a
 * completed checkout would leave it; Stripe's answers come from `stripe.fake.ts`, and Stripe's webhooks
 * are signed for real and posted to the public endpoint.
 */

import { Before, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import { BDD_PRICE_BY_PLAN, BDD_STRIPE_WEBHOOK_SECRET, stripeBehaviour, stripeSdk } from '../support/stripe.fake';
import { fixturesPrisma } from '../support/db.fixtures';
import type { BddWorldInterface } from '../support/world';
import { theCompany } from './billing-plan.steps';

Before({ tags: '@billing-plan-change' }, function () {
    stripeBehaviour.declineNextUpgrade = false;
    stripeBehaviour.upgradeRequests.length = 0;
});

const subscriptionOf = (tenantId: string): string => `sub_bdd_${tenantId}`;
const customerOf = (tenantId: string): string => `cus_bdd_${tenantId}`;
let eventSeq = 0;

async function deliver(world: BddWorldInterface, type: string, object: Record<string, unknown>): Promise<void> {
    eventSeq += 1;
    const payload = JSON.stringify({
        id: `evt_bdd_pc_${Date.now()}_${eventSeq}`,
        object: 'event',
        type,
        created: Math.floor(Date.now() / 1000) + eventSeq,
        data: { object }
    });
    world.response = await world
        .agent()
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', stripeSdk.webhooks.generateTestHeaderString({ payload, secret: BDD_STRIPE_WEBHOOK_SECRET }))
        .send(payload);
    assert.strictEqual(world.response.status, 200, `Stripe webhook refused: ${JSON.stringify(world.response.body)}`);
}

// ─── Given ───────────────────────────────────────────────────────────────────

Given('that company has a live {string} subscription', async function (plan: string) {
    const { tenantId } = theCompany();
    // A signed-up company gets its billing row on first read, so it may not exist yet.
    const live = { plan, status: 'active', stripeSubscriptionId: subscriptionOf(tenantId), stripeCustomerId: customerOf(tenantId) };
    await fixturesPrisma.billing.upsert({ where: { tenantId }, create: { tenantId, ...live }, update: live });
});

Given("that company's payments are {string}", async function (paymentStatus: string) {
    await fixturesPrisma.tenant.update({ where: { id: theCompany().tenantId }, data: { paymentStatus } });
});

Given('Stripe will decline the card on the next upgrade', function () {
    stripeBehaviour.declineNextUpgrade = true;
});

// ─── When ────────────────────────────────────────────────────────────────────

When("Stripe delivers that company's paid invoice in its current shape", async function (this: BddWorldInterface) {
    const { tenantId } = theCompany();
    await deliver(this, 'invoice.paid', {
        id: `in_bdd_${tenantId}`,
        object: 'invoice',
        customer: customerOf(tenantId),
        parent: { type: 'subscription_details', subscription_details: { subscription: subscriptionOf(tenantId) } },
        payments: { data: [{ payment: { type: 'payment_intent', payment_intent: `pi_bdd_${tenantId}` } }] }
    });
});

When("Stripe reports that company's subscription moved to {string}", async function (this: BddWorldInterface, plan: string) {
    const { tenantId } = theCompany();
    const now = Math.floor(Date.now() / 1000);
    await deliver(this, 'customer.subscription.updated', {
        id: subscriptionOf(tenantId),
        object: 'subscription',
        customer: customerOf(tenantId),
        status: 'active',
        cancel_at_period_end: false,
        items: { data: [{ price: { id: BDD_PRICE_BY_PLAN[plan] }, current_period_start: now, current_period_end: now + 30 * 86_400 }] }
    });
});

When("Stripe reports that company's subscription ended", async function (this: BddWorldInterface) {
    const { tenantId } = theCompany();
    await deliver(this, 'customer.subscription.deleted', {
        id: subscriptionOf(tenantId),
        object: 'subscription',
        customer: customerOf(tenantId),
        status: 'canceled',
        ended_at: Math.floor(Date.now() / 1000)
    });
});

// ─── Then ────────────────────────────────────────────────────────────────────

Then("that company's billing is on plan {string} with status {string}", async function (plan: string, status: string) {
    const billing = await fixturesPrisma.billing.findUniqueOrThrow({ where: { tenantId: theCompany().tenantId } });
    assert.strictEqual(billing.plan, plan);
    assert.strictEqual(billing.status, status);
});

Then("that company's payments are back to {string}", async function (paymentStatus: string) {
    const tenant = await fixturesPrisma.tenant.findUniqueOrThrow({ where: { id: theCompany().tenantId }, select: { paymentStatus: true } });
    assert.strictEqual(tenant.paymentStatus, paymentStatus);
});

Then('Stripe was asked to move the subscription to {string}', function (plan: string) {
    assert.deepStrictEqual(stripeBehaviour.upgradeRequests, [{ stripeSubscriptionId: subscriptionOf(theCompany().tenantId), targetPlan: plan }]);
});

Then('Stripe was asked for no upgrade', function () {
    assert.deepStrictEqual(stripeBehaviour.upgradeRequests, []);
});

Then('the error code is {string}', function (this: BddWorldInterface, code: string) {
    assert.strictEqual((this.response?.body as { error?: { code?: string } }).error?.code, code);
});

Then('the end of the subscription is audit-logged with the system as actor', async function () {
    const rows = await fixturesPrisma.auditLog.findMany({ where: { tenantId: theCompany().tenantId, action: 'subscription.cancelled' } });
    assert.strictEqual(rows.length, 1, `Expected one subscription.cancelled audit row, got ${rows.length}`);
    assert.strictEqual(rows[0]!.actorUserId, 'system');
});
