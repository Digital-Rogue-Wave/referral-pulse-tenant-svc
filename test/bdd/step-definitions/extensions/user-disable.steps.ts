/**
 * Reversible disable (tenant-service extension; the v5.2 tracker has no matching active story). Reuses the signed-up company of `billing-plan.steps.ts`;
 * the member is written straight into the real Postgres, the routes run through the real HTTP stack, and the
 * Keto effects and audit rows are read back from the same database.
 */

import { After, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { ulid } from 'ulid';

import { theCompany } from '../common/billing-plan.steps';
import { ensureMember, fixturesPrisma } from '../../support/db.fixtures';
import type { BddWorldInterface } from '../../support/world';

let memberId = '';

After({ tags: '@user-disable' }, async function () {
    await fixturesPrisma.sideEffectOutbox.deleteMany({ where: { tenantId: theCompany().tenantId } });
    memberId = '';
});

Given('that company has an {string} member', async function (role: string) {
    memberId = ulid();
    await ensureMember({
        tenantId: theCompany().tenantId,
        userId: memberId,
        kratosIdentityId: `kratos-${memberId}`,
        email: `${memberId.toLowerCase()}@member.test`,
        role
    });
});

When('I {string} that member', async function (this: BddWorldInterface, action: string) {
    this.response = await this.agent()
        .post(`/api/v1/users/${memberId}/${action}`)
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', `bdd-${action}-${memberId}-${ulid()}`);
});

When('I {string} the Owner', async function (this: BddWorldInterface, action: string) {
    this.response = await this.agent()
        .post(`/api/v1/users/${theCompany().ownerUserId}/${action}`)
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', `bdd-${action}-owner-${ulid()}`);
});

Then('that member answers with status {string} and a disabled date', function (this: BddWorldInterface, status: string) {
    const body = this.response.body as { id: string; status: string; disabled_at: string | null };
    assert.strictEqual(body.id, memberId);
    assert.strictEqual(body.status, status);
    assert.ok(body.disabled_at, 'disabled_at is not set');
});

Then('that member answers with status {string} and no disabled date', function (this: BddWorldInterface, status: string) {
    const body = this.response.body as { status: string; disabled_at?: string | null };
    assert.strictEqual(body.status, status);
    assert.ok(!body.disabled_at, `disabled_at is ${body.disabled_at}`);
});

Then("that member's row is kept, disabled and not deleted", async function () {
    const row = await fixturesPrisma.user.findUniqueOrThrow({ where: { id: memberId } });
    assert.strictEqual(row.status, 'disabled');
    assert.ok(row.disabledAt instanceof Date);
    assert.strictEqual(row.deletedAt, null);
});

Then('a Keto {string} effect is queued for that member', async function (operation: string) {
    // The Keto listener runs after the response (async), so the effect may land a moment later.
    let payloads: Array<{ operation?: string; userId?: string }> = [];
    for (let attempt = 0; attempt < 20; attempt++) {
        const rows = await fixturesPrisma.sideEffectOutbox.findMany({ where: { tenantId: theCompany().tenantId, effectType: 'keto' } });
        payloads = rows.map((row) => row.payload as { operation?: string; userId?: string });
        if (payloads.some((payload) => payload.operation === operation && payload.userId === memberId)) {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
        payloads.some((payload) => payload.operation === operation && payload.userId === memberId),
        `no ${operation} effect for ${memberId}: ${JSON.stringify(payloads)}`
    );
});

Then('{string} is on the audit trail for that member', async function (action: string) {
    const rows = await fixturesPrisma.auditLog.findMany({ where: { tenantId: theCompany().tenantId, action, targetId: memberId } });
    assert.strictEqual(rows.length, 1, `audit rows for ${action}: ${rows.length}`);
    assert.strictEqual(rows[0]!.actorUserId, theCompany().ownerUserId);
});
