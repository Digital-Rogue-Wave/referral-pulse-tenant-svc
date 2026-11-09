/**
 * The widget-token secret (US1.5.4): the Owner's read and rotation, and what Event Ingestion receives.
 *
 * Each scenario signs a fresh company up through the Ory sign-up hook (so the secret is created the real way,
 * sealed) and removes it afterwards; their slugs start with `bdd-ws-`.
 */

import { After, Before, Given, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { randomUUID } from 'crypto';

import { makeActiveUserToken, makeServiceToken } from '../support/jwt.helper';
import { denyKetoFor } from '../support/nock.setup';
import { fixturesPrisma, purgeAuditRows } from '../support/db.fixtures';
import type { BddWorldInterface } from '../support/world';

const SLUG_PREFIX = 'bdd-ws-';
const HEX_SECRET = /^[0-9a-f]{64}$/;

let company: { tenantId: string; ownerUserId: string } | null = null;
let secretBefore: string | null = null;

async function removeCompanies(): Promise<void> {
    const tenants = await fixturesPrisma.tenant.findMany({ where: { slug: { startsWith: SLUG_PREFIX } }, select: { id: true } });
    const ids = tenants.map((t) => t.id);
    if (ids.length === 0) {
        return;
    }
    await fixturesPrisma.eventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
    await purgeAuditRows(ids);
    await fixturesPrisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

Before({ tags: '@widget-secret' }, async function () {
    company = null;
    secretBefore = null;
    await removeCompanies();
});

After({ tags: '@widget-secret' }, async function () {
    await removeCompanies();
});

function theCompany(): { tenantId: string; ownerUserId: string } {
    assert.ok(company, 'No company signed up in this scenario');
    return company;
}

async function serviceRead(world: BddWorldInterface): Promise<Record<string, unknown>> {
    const response = await world
        .agent()
        .get(`/api/v1/internal/tenants/${theCompany().tenantId}/widget-token-secret`)
        .set('Authorization', `Bearer ${makeServiceToken('ingestion-svc')}`);
    assert.strictEqual(response.status, 200, `Internal read failed: ${JSON.stringify(response.body)}`);
    return response.body as Record<string, unknown>;
}

function responseSecret(world: BddWorldInterface): string {
    return String((world.response?.body as { secret?: unknown }).secret);
}

// ─── Given ───────────────────────────────────────────────────────────────────

Given('a company has signed itself up', async function (this: BddWorldInterface) {
    const identityId = `kratos-bdd-ws-${randomUUID()}`;
    const response = await this.agent()
        .post('/api/v1/webhook/ory/signup')
        .set('x-ory-api-key', String(process.env['ORY_WEBHOOK_API_KEY']))
        .send({ identity: { id: identityId, traits: { email: `${identityId}@acme.com`, tenantName: `bdd-ws ${randomUUID().slice(0, 8)}` } } });
    assert.strictEqual(response.status, 201, `Sign-up failed: ${JSON.stringify(response.body)}`);
    const tenantId = (response.body as { tenant_id: string }).tenant_id;
    const owner = await fixturesPrisma.user.findFirstOrThrow({ where: { tenantId, kratosIdentityId: identityId }, select: { id: true } });
    company = { tenantId, ownerUserId: owner.id };
});

Given("I am that company's Owner", function (this: BddWorldInterface) {
    this.currentToken = makeActiveUserToken(theCompany().tenantId, theCompany().ownerUserId);
});

Given('I am a member of that company without api_keys:manage', function (this: BddWorldInterface) {
    // `api_keys:manage` is checked live in Keto, so the refusal comes from Keto, as for a real Support Agent.
    const userId = `user-bdd-ws-${randomUUID()}`;
    denyKetoFor(`user:${userId}`);
    this.currentToken = makeActiveUserToken(theCompany().tenantId, userId);
});

Given('I have read the current secret', async function (this: BddWorldInterface) {
    secretBefore = String((await serviceRead(this))['secret']);
});

// ─── Then ────────────────────────────────────────────────────────────────────

Then('the response holds a 64-character hex secret', function (this: BddWorldInterface) {
    assert.match(responseSecret(this), HEX_SECRET);
});

Then('it is the secret Event Ingestion receives', async function (this: BddWorldInterface) {
    assert.strictEqual((await serviceRead(this))['secret'], responseSecret(this));
});

Then('the database does not hold it in plain text', async function (this: BddWorldInterface) {
    const row = await fixturesPrisma.tenant.findUniqueOrThrow({ where: { id: theCompany().tenantId }, select: { widgetTokenSecret: true } });
    assert.ok(row.widgetTokenSecret, 'No stored secret');
    assert.notStrictEqual(row.widgetTokenSecret, responseSecret(this));
    assert.doesNotMatch(row.widgetTokenSecret, HEX_SECRET);
});

Then('the read is audit-logged with the Owner as actor', async function () {
    const rows = await fixturesPrisma.auditLog.findMany({ where: { tenantId: theCompany().tenantId, action: 'tenant.widget_secret_revealed' } });
    assert.strictEqual(rows.length, 1, `Expected one audit row, found ${rows.length}`);
    assert.strictEqual(rows[0]!.actorUserId, theCompany().ownerUserId);
});

Then('it differs from the secret before the rotation', function (this: BddWorldInterface) {
    assert.ok(secretBefore, 'The secret before the rotation was not read');
    assert.notStrictEqual(responseSecret(this), secretBefore);
});

Then('Event Ingestion receives the new secret and the previous one until about an hour from now', async function (this: BddWorldInterface) {
    const body = await serviceRead(this);
    assert.strictEqual(body['secret'], responseSecret(this));
    assert.strictEqual(body['previous_secret'], secretBefore);
    const minutesLeft = (new Date(String(body['previous_valid_until'])).getTime() - Date.now()) / 60_000;
    assert.ok(minutesLeft > 58 && minutesLeft <= 60, `previous_valid_until is ${minutesLeft.toFixed(1)} min away`);
});

Then('{string} is queued for that company without the secret', async function (this: BddWorldInterface, eventType: string) {
    const rows = await fixturesPrisma.eventOutbox.findMany({ where: { tenantId: theCompany().tenantId, eventType } });
    assert.strictEqual(rows.length, 1, `Expected one ${eventType} outbox row, found ${rows.length}`);
    const payload = JSON.stringify(rows[0]!.payload);
    assert.ok(!payload.includes(responseSecret(this)) && !payload.includes(String(secretBefore)), 'A secret is in the event');
});
