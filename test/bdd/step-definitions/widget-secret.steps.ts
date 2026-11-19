/**
 * The widget signing secrets (US1.5.4, v5.2 US1.5.5): the Owner's read and rotation with kids, and what Event Ingestion receives.
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

type Secret = { kid: string; secret: string; created_at: string; expires_at: string | null };

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

function responseSecrets(world: BddWorldInterface): Secret[] {
    return (world.response?.body as { secrets: Secret[] }).secrets;
}

function responseSecret(world: BddWorldInterface): string {
    return responseSecrets(world)[0]!.secret;
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
    secretBefore = ((await serviceRead(this))['secrets'] as Secret[])[0]!.secret;
});

// ─── Then ────────────────────────────────────────────────────────────────────

Then(/^the response holds (\d+) secrets?, a kid and a 64-character hex secret each$/, function (this: BddWorldInterface, count: string) {
    const secrets = responseSecrets(this);
    assert.strictEqual(secrets.length, Number(count), JSON.stringify(secrets.map((s) => s.kid)));
    for (const secret of secrets) {
        assert.match(secret.kid, /^[0-9a-f]{16}$/);
        assert.match(secret.secret, HEX_SECRET);
    }
    assert.strictEqual(secrets[0]!.expires_at, null, 'The newest secret has no end');
});

Then('it is what Event Ingestion receives', async function (this: BddWorldInterface) {
    assert.deepStrictEqual((await serviceRead(this))['secrets'], responseSecrets(this));
});

Then('the database does not hold it in plain text', async function (this: BddWorldInterface) {
    const row = await fixturesPrisma.tenant.findUniqueOrThrow({ where: { id: theCompany().tenantId }, select: { widgetSigningSecrets: true } });
    const stored = JSON.stringify(row.widgetSigningSecrets);
    assert.ok(stored.includes(responseSecrets(this)[0]!.kid), 'No stored entry for that kid');
    assert.ok(!stored.includes(responseSecret(this)), 'The secret is stored in plain text');
});

Then(/^the (read|rotation) is audit-logged with the Owner as actor$/, async function (kind: string) {
    const action = kind === 'read' ? 'tenant.widget_secret_revealed' : 'tenant.widget_secret_rotated';
    const rows = await fixturesPrisma.auditLog.findMany({ where: { tenantId: theCompany().tenantId, action } });
    assert.strictEqual(rows.length, 1, `Expected one ${action} audit row, found ${rows.length}`);
    assert.strictEqual(rows[0]!.actorUserId, theCompany().ownerUserId);
});

Then('the newest is new and the previous one is the secret before the rotation, valid until 7 days from now', function (this: BddWorldInterface) {
    assert.ok(secretBefore, 'The secret before the rotation was not read');
    const [newest, previous] = responseSecrets(this);
    assert.notStrictEqual(newest!.secret, secretBefore);
    assert.strictEqual(previous!.secret, secretBefore);
    const daysLeft = (new Date(String(previous!.expires_at)).getTime() - Date.now()) / 86_400_000;
    assert.ok(daysLeft > 6.99 && daysLeft <= 7, `The previous secret ends in ${daysLeft.toFixed(3)} days`);
});

Then('{string} is queued for that company with the new kid and without a secret', async function (this: BddWorldInterface, eventType: string) {
    const rows = await fixturesPrisma.eventOutbox.findMany({ where: { tenantId: theCompany().tenantId, eventType } });
    assert.strictEqual(rows.length, 1, `Expected one ${eventType} outbox row, found ${rows.length}`);
    const payload = JSON.stringify(rows[0]!.payload);
    assert.ok(payload.includes(responseSecrets(this)[0]!.kid), 'The new kid is not in the event');
    assert.ok(!payload.includes(responseSecret(this)) && !payload.includes(String(secretBefore)), 'A secret is in the event');
});
