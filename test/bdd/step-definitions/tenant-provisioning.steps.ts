/**
 * Tenant provisioning by a Super Admin (US1.1.1).
 *
 * Keto is stubbed to allow by default (nock.setup.ts), so the seeded Owner of `default-tenant` acts as the
 * Super Admin; the refusal scenario uses a fresh user id each run, because Keto decisions are cached in Redis.
 * Every tenant this feature creates has a `bdd-prov-` slug and is removed before and after each scenario.
 */

import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { createHash, randomUUID } from 'crypto';

import { BDD_OWNER, makeActiveUserToken, makeInviteeToken } from '../support/jwt.helper';
import { denyKetoFor, stubKratosIdentity } from '../support/nock.setup';
import { fixturesPrisma, purgeAuditRows } from '../support/db.fixtures';
import type { BddWorldInterface } from '../support/world';

const SLUG_PREFIX = 'bdd-prov-';
const RUN_ID = Date.now().toString(36);
const ADMIN_TENANT_ID = 'default-tenant';

/** The tenant the last successful creation returned; one per scenario. */
let createdTenant: { id: string; slug: string } | null = null;
/** Tenants created through the Ory sign-up hook in this scenario, in order. */
let signedUp: { tenantCreated: boolean; tenantId: string | null }[] = [];

async function removeProvisionedTenants(): Promise<void> {
    const tenants = await fixturesPrisma.tenant.findMany({ where: { slug: { startsWith: SLUG_PREFIX } }, select: { id: true } });
    const ids = tenants.map((t) => t.id);
    if (ids.length === 0) {
        return;
    }
    // Invitations, users, roles and verifications cascade with the tenant; the outbox and the audit trail don't.
    await fixturesPrisma.eventOutbox.deleteMany({ where: { tenantId: { in: ids } } });
    await purgeAuditRows(ids);
    await fixturesPrisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

Before({ tags: '@tenant-provisioning' }, async function () {
    createdTenant = null;
    signedUp = [];
    await removeProvisionedTenants();
});

After({ tags: '@tenant-provisioning' }, async function () {
    await removeProvisionedTenants();
});

function newTenant(): { id: string; slug: string } {
    assert.ok(createdTenant, 'No tenant was created in this scenario');
    return createdTenant;
}

async function postTenant(world: BddWorldInterface, body: Record<string, string>): Promise<void> {
    assert.ok(world.currentToken, 'No token set — use a "Given I am signed in …" step first');
    world.response = await world
        .agent()
        .post('/api/v1/admin/tenants')
        .set('Authorization', `Bearer ${world.currentToken}`)
        .set('Idempotency-Key', `bdd-${randomUUID()}`)
        .send(body);
    if (world.response.status === 201) {
        const tenant = (world.response.body as { tenant: { id: string; slug: string } }).tenant;
        createdTenant = { id: tenant.id, slug: tenant.slug };
    }
}

// ─── Given ───────────────────────────────────────────────────────────────────

Given('I am signed in as a Super Admin', function (this: BddWorldInterface) {
    this.currentToken = makeActiveUserToken(ADMIN_TENANT_ID, BDD_OWNER.userId);
});

Given('I am signed in as a tenant Owner without the platform grant', function (this: BddWorldInterface) {
    const userId = `user-bdd-${randomUUID()}`;
    denyKetoFor(`user:${userId}`);
    this.currentToken = makeActiveUserToken(ADMIN_TENANT_ID, userId);
});

Given("the Owner's invitation link carries the token {string}", async function (token: string) {
    // The raw token exists only in the invitation email; the test pins a known one by its stored hash.
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    const updated = await fixturesPrisma.invitation.updateMany({ where: { tenantId: newTenant().id }, data: { tokenHash } });
    assert.strictEqual(updated.count, 1, 'Expected exactly one invitation on the new tenant');
});

Given('{string} is signed in with the Ory identity {string}', function (this: BddWorldInterface, email: string, identityId: string) {
    stubKratosIdentity(identityId, email);
    this.currentToken = makeInviteeToken(email, identityId);
});

// ─── When ────────────────────────────────────────────────────────────────────

When('I create the tenant {string} for the owner {string}', async function (this: BddWorldInterface, name: string, ownerEmail: string) {
    await postTenant(this, { name, slug: `${SLUG_PREFIX}${randomUUID().slice(0, 8)}`, owner_email: ownerEmail });
});

When('I create another tenant with the same slug for the owner {string}', async function (this: BddWorldInterface, ownerEmail: string) {
    const taken = newTenant().slug;
    await postTenant(this, { name: 'Acme Again', slug: taken, owner_email: ownerEmail });
});

When(/^(?:a|another) company named "([^"]+)" signs up through the Ory sign-up hook$/, async function (this: BddWorldInterface, name: string) {
    // The run id keeps the name unique per run, so a leftover tenant from an earlier run never collides.
    const company = `${name} ${RUN_ID}`;
    const identityId = `kratos-bdd-prov-${randomUUID()}`;
    const response = await this.agent()
        .post('/api/v1/webhook/ory/signup')
        .set('x-ory-api-key', String(process.env['ORY_WEBHOOK_API_KEY']))
        .send({ identity: { id: identityId, traits: { email: `${identityId}@acme.com`, tenantName: company } } });
    const body = response.body as { tenant_created?: boolean; tenant_id?: string };
    signedUp.push({ tenantCreated: response.status === 201 && body.tenant_created === true, tenantId: body.tenant_id ?? null });
});

// ─── Then ────────────────────────────────────────────────────────────────────

Then(
    'the response holds an active tenant {string} whose verification is {string}',
    function (this: BddWorldInterface, name: string, verification: string) {
        const tenant = (this.response?.body as { tenant?: Record<string, unknown> }).tenant;
        assert.ok(tenant, `No tenant in the response: ${JSON.stringify(this.response?.body)}`);
        assert.strictEqual(tenant['name'], name);
        assert.strictEqual(tenant['status'], 'active');
        assert.strictEqual(tenant['verification_status'], verification);
        assert.ok(String(tenant['slug']).startsWith(SLUG_PREFIX));
    }
);

Then('the response holds a pending {string} invitation for {string}', function (this: BddWorldInterface, role: string, email: string) {
    const invitation = (this.response?.body as { owner_invitation?: Record<string, unknown> }).owner_invitation;
    assert.ok(invitation, `No owner_invitation in the response: ${JSON.stringify(this.response?.body)}`);
    assert.strictEqual(invitation['email'], email);
    assert.strictEqual(invitation['role'], role);
    assert.strictEqual(invitation['status'], 'PENDING');
    assert.strictEqual(invitation['tenant_id'], newTenant().id);
});

Then('the response carries neither the widget token secret nor the invitation token hash', function (this: BddWorldInterface) {
    const body = this.response?.body as { tenant: Record<string, unknown>; owner_invitation: Record<string, unknown> };
    assert.ok(!('widget_token_secret' in body.tenant), 'tenant.widget_token_secret leaked');
    assert.ok(!('token_hash' in body.owner_invitation), 'owner_invitation.token_hash leaked');
});

Then('both sign-ups created a tenant', function () {
    assert.strictEqual(signedUp.length, 2);
    assert.ok(
        signedUp.every((s) => s.tenantCreated && s.tenantId),
        `Expected two created tenants, got ${JSON.stringify(signedUp)}`
    );
    assert.notStrictEqual(signedUp[0]!.tenantId, signedUp[1]!.tenantId);
});

Then("the second tenant's slug is the first one's plus a 6-character suffix", async function () {
    const [first, second] = await Promise.all(
        signedUp.map((s) => fixturesPrisma.tenant.findUniqueOrThrow({ where: { id: s.tenantId! }, select: { id: true, slug: true } }))
    );
    assert.strictEqual(second!.slug, `${first!.slug}-${second!.id.slice(-6).toLowerCase()}`);
});

Then('the new tenant has no members yet', async function () {
    const members = await fixturesPrisma.user.count({ where: { tenantId: newTenant().id } });
    assert.strictEqual(members, 0);
});

Then('the new tenant has exactly one pending {string} invitation for {string}', async function (role: string, email: string) {
    const invitations = await fixturesPrisma.invitation.findMany({ where: { tenantId: newTenant().id } });
    assert.strictEqual(invitations.length, 1, `Expected one invitation, found ${invitations.length}`);
    assert.strictEqual(invitations[0]!.email, email);
    assert.strictEqual(invitations[0]!.role, role);
    assert.strictEqual(invitations[0]!.status, 'PENDING');
});

Then('{string} is queued in the outbox for the new tenant', async function (eventType: string) {
    const rows = await fixturesPrisma.eventOutbox.count({ where: { tenantId: newTenant().id, eventType } });
    assert.strictEqual(rows, 1, `Expected one ${eventType} outbox row, found ${rows}`);
});

Then('the creation of the new tenant is audit-logged with the Super Admin as actor', async function () {
    const rows = await fixturesPrisma.auditLog.findMany({ where: { tenantId: newTenant().id, action: 'tenant.created' } });
    assert.strictEqual(rows.length, 1, `Expected one tenant.created audit row, found ${rows.length}`);
    assert.strictEqual(rows[0]!.actorUserId, BDD_OWNER.userId);
});

Then('{string} is the {string} of the new tenant', async function (email: string, role: string) {
    const member = await fixturesPrisma.user.findFirst({ where: { tenantId: newTenant().id, email, deletedAt: null } });
    assert.ok(member, `${email} is not a member of the new tenant`);
    assert.strictEqual(member.role, role);
});

Then('no invitation exists for {string}', async function (email: string) {
    const invitations = await fixturesPrisma.invitation.count({ where: { email } });
    assert.strictEqual(invitations, 0);
});
