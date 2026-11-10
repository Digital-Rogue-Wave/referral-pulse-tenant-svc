/**
 * Reading the audit trail (US1.9.2). Reuses the signed-up company of `billing-plan.steps.ts` (same Before/After
 * clean-up). The rows are written by real actions through the HTTP stack and read back through
 * `GET /v1/audit-log` against the real Postgres, the test a mocked unit test could not be (F3).
 */

import { After, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { ulid } from 'ulid';

import { ALL_PERMISSIONS } from '../../../src/common/auth/authz/permission-catalog';
import { fixturesPrisma, purgeAuditRows } from '../support/db.fixtures';
import { makeActiveUserToken } from '../support/jwt.helper';
import type { BddWorldInterface } from '../support/world';
import { theCompany } from './billing-plan.steps';

const OTHER_TENANT = 'bdd-audit-other-tenant';

type Entry = Record<string, unknown> & { id: string; action: string };
type Page = { data: Entry[]; has_more: boolean; next_cursor: string | null };
let firstPage: Page | null = null;

const page = (world: BddWorldInterface): Page => world.response?.body as Page;

After({ tags: '@audit-log-read' }, async function () {
    firstPage = null;
    await purgeAuditRows([OTHER_TENANT]);
});

async function putSettings(world: BddWorldInterface, currencyCode: string): Promise<void> {
    const response = await world.agent().put('/api/v1/tenant-settings').set('Authorization', `Bearer ${world.currentToken}`).send({ currencyCode });
    assert.strictEqual(response.status, 200, `settings refused: ${JSON.stringify(response.body)}`);
}

// ─── Given ───────────────────────────────────────────────────────────────────

Given('that company changed its currency from {string} to {string}', async function (this: BddWorldInterface, from: string, to: string) {
    await putSettings(this, from);
    await putSettings(this, to);
});

Given('another company has an audit entry {string}', async function (action: string) {
    await fixturesPrisma.auditLog.create({ data: { id: ulid(), tenantId: OTHER_TENANT, actorUserId: 'system', action, occurredAt: new Date() } });
});

Given('I am a member of that billing company without audit:read', function (this: BddWorldInterface) {
    const perms = ALL_PERMISSIONS.filter((p) => p !== 'audit:read');
    this.currentToken = makeActiveUserToken(theCompany().tenantId, 'user-bdd-no-audit-read', [...perms]);
});

// ─── When ────────────────────────────────────────────────────────────────────

When('I follow the next cursor with that token', async function (this: BddWorldInterface) {
    firstPage = page(this);
    assert.ok(firstPage.next_cursor, 'the first page has no next_cursor');
    this.response = await this.agent()
        .get(`/api/v1/audit-log?limit=1&starting_after=${firstPage.next_cursor}`)
        .set('Authorization', `Bearer ${this.currentToken}`);
});

// ─── Then ────────────────────────────────────────────────────────────────────

Then(
    'the first audit entry is {string} by the Owner, from {string} to {string}',
    function (this: BddWorldInterface, action: string, from: string, to: string) {
        const [first] = page(this).data;
        assert.strictEqual(first!.action, action);
        assert.strictEqual(first!.actor_user_id, theCompany().ownerUserId);
        assert.deepStrictEqual(first!.before, { currency_code: from });
        assert.deepStrictEqual(first!.after, { currency_code: to });
    }
);

Then('the audit entries are newest first', function (this: BddWorldInterface) {
    const times = page(this).data.map((entry) => Date.parse(String(entry.occurred_at)));
    assert.deepStrictEqual(
        times,
        [...times].sort((a, b) => b - a)
    );
});

Then('no audit entry carries an IP hash', function (this: BddWorldInterface) {
    assert.ok(page(this).data.length > 0, 'no entries to check');
    page(this).data.forEach((entry) => assert.ok(!('ip_hash' in entry), `entry ${entry.id} carries ip_hash`));
});

Then('every audit entry is a {string}', function (this: BddWorldInterface, action: string) {
    page(this).data.forEach((entry) => assert.strictEqual(entry.action, action));
});

Then('there is exactly {int} audit entr(y)(ies)', function (this: BddWorldInterface, count: number) {
    assert.strictEqual(page(this).data.length, count);
});

Then('there is exactly {int} audit entry, and more after it', function (this: BddWorldInterface, count: number) {
    assert.strictEqual(page(this).data.length, count);
    assert.strictEqual(page(this).has_more, true);
});

Then('the page holds an older audit entry than the first page', function (this: BddWorldInterface) {
    const [older] = page(this).data;
    assert.ok(older && firstPage?.data[0], 'missing entries');
    assert.ok(older.id < firstPage.data[0].id, `${older.id} is not older than ${firstPage.data[0].id}`);
});
