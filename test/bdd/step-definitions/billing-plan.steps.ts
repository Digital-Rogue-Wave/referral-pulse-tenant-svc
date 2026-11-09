/**
 * The current plan and its limits (US1.8.1). Each scenario signs a fresh company up (Free plan, one Owner,
 * 2 seats) and removes it afterwards; their slugs start with `bdd-bp-`. The public plan list is cached in
 * Redis, so it is cleared first to read what the seed holds.
 */

import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { randomUUID } from 'crypto';

import { PlanService } from '../../../src/features/billing/plan.service';
import { getTestApp } from '../support/app.bootstrap';
import { makeActiveUserToken, makeServiceToken } from '../support/jwt.helper';
import { fixturesPrisma } from '../support/db.fixtures';
import type { BddWorldInterface } from '../support/world';

const SLUG_PREFIX = 'bdd-bp-';

let company: { tenantId: string; ownerUserId: string } | null = null;

async function removeCompanies(): Promise<void> {
    const tenants = await fixturesPrisma.tenant.findMany({ where: { slug: { startsWith: SLUG_PREFIX } }, select: { id: true } });
    const ids = tenants.map((t) => t.id);
    if (ids.length === 0) {
        return;
    }
    await fixturesPrisma.eventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
    await fixturesPrisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
    await fixturesPrisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

Before({ tags: '@billing-plan or @billing-plan-change or @invoice-history' }, async function () {
    company = null;
    await removeCompanies();
    await getTestApp().get(PlanService).invalidateCaches();
});

After({ tags: '@billing-plan or @billing-plan-change or @invoice-history' }, async function () {
    await removeCompanies();
});

export function theCompany(): { tenantId: string; ownerUserId: string } {
    assert.ok(company, 'No company signed up in this scenario');
    return company;
}

const body = (world: BddWorldInterface): Record<string, unknown> => world.response?.body as Record<string, unknown>;

// ─── Given / When ────────────────────────────────────────────────────────────

Given('a company has signed itself up for billing', async function (this: BddWorldInterface) {
    const identityId = `kratos-bdd-bp-${randomUUID()}`;
    const response = await this.agent()
        .post('/api/v1/webhook/ory/signup')
        .set('x-ory-api-key', String(process.env['ORY_WEBHOOK_API_KEY']))
        .send({ identity: { id: identityId, traits: { email: `${identityId}@acme.com`, tenantName: `bdd-bp ${randomUUID().slice(0, 8)}` } } });
    assert.strictEqual(response.status, 201, `Sign-up failed: ${JSON.stringify(response.body)}`);
    const tenantId = (response.body as { tenant_id: string }).tenant_id;
    const owner = await fixturesPrisma.user.findFirstOrThrow({ where: { tenantId, kratosIdentityId: identityId }, select: { id: true } });
    company = { tenantId, ownerUserId: owner.id };
});

Given("I am that billing company's Owner", function (this: BddWorldInterface) {
    this.currentToken = makeActiveUserToken(theCompany().tenantId, theCompany().ownerUserId);
});

When("Event Ingestion reads that company's entitlements", async function (this: BddWorldInterface) {
    this.response = await this.agent()
        .get(`/api/v1/internal/tenants/${theCompany().tenantId}/entitlements`)
        .set('Authorization', `Bearer ${makeServiceToken('ingestion-svc')}`);
});

// ─── Then ────────────────────────────────────────────────────────────────────

Then('the plans offered are {string}', function (this: BddWorldInterface, names: string) {
    const plans = this.response?.body as { name: string }[];
    assert.deepStrictEqual(plans.map((p) => p.name).sort(), names.split(', ').sort());
});

Then('every plan has an {string} limit and a {string} field', function (this: BddWorldInterface, limit: string, field: string) {
    for (const plan of this.response?.body as Record<string, unknown>[]) {
        const limits = plan['limits'] as Record<string, unknown>;
        assert.strictEqual(typeof limits[limit], 'number', `${String(plan['name'])} has no ${limit}`);
        assert.ok(field in plan, `${String(plan['name'])} has no "${field}" field`);
    }
});

Then('the usage of {string} is {int} of {int}', function (this: BddWorldInterface, metric: string, used: number, limit: number) {
    const metrics = body(this)['metrics'] as { metric: string; current_usage: number; limit: number | null }[];
    const row = metrics.find((m) => m.metric === metric);
    assert.ok(row, `No ${metric} in the usage: ${JSON.stringify(metrics)}`);
    assert.strictEqual(row.current_usage, used);
    assert.strictEqual(row.limit, limit);
});

Then('every limit of the {string} plan is listed in the usage', async function (this: BddWorldInterface, planName: string) {
    const plan = await fixturesPrisma.plan.findFirstOrThrow({ where: { name: planName, tenantId: null, deletedAt: null } });
    const listed = new Set((body(this)['metrics'] as { metric: string }[]).map((m) => m.metric));
    for (const metric of Object.keys(plan.limits as Record<string, number>)) {
        assert.ok(listed.has(metric), `The usage does not list "${metric}"`);
    }
});

Then('the entitlements limit {string} is {int}', function (this: BddWorldInterface, metric: string, value: number) {
    assert.strictEqual((body(this)['limits'] as Record<string, unknown>)[metric], value);
});
