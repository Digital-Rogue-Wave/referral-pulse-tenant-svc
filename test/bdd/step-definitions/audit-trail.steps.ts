/**
 * The audit trail (US1.9.1). Reuses the signed-up company of `billing-plan.steps.ts` (same Before/After
 * clean-up, which purges its audit rows the opted-in way). Actions go through the real HTTP stack; the
 * append-only trigger is exercised straight on the database, as any code path or mistake would hit it.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { ulid } from 'ulid';

import { ALL_PERMISSIONS } from '../../../src/common/auth/authz/permission-catalog';
import { fixturesPrisma, purgeAuditRows } from '../support/db.fixtures';
import { makeActiveUserToken } from '../support/jwt.helper';
import type { BddWorldInterface } from '../support/world';
import { theCompany } from './billing-plan.steps';

const PROBE_ACTION = 'bdd.audit_probe';
let probeId = '';

async function rowsOf(action: string) {
    return fixturesPrisma.auditLog.findMany({ where: { tenantId: theCompany().tenantId, action } });
}

async function refusal(attempt: () => Promise<unknown>): Promise<string> {
    try {
        await attempt();
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    return 'not refused';
}

// ─── Given ───────────────────────────────────────────────────────────────────

Given('I am a member of that billing company without tenants:write', function (this: BddWorldInterface) {
    const perms = ALL_PERMISSIONS.filter((p) => p !== 'tenants:write');
    this.currentToken = makeActiveUserToken(theCompany().tenantId, 'user-bdd-no-tenants-write', [...perms]);
});

Given('that company has an audit row', async function () {
    probeId = ulid();
    await fixturesPrisma.auditLog.create({
        data: {
            id: probeId,
            tenantId: theCompany().tenantId,
            actorUserId: 'system',
            action: PROBE_ACTION,
            reason: 'original',
            occurredAt: new Date()
        }
    });
});

// ─── When ────────────────────────────────────────────────────────────────────

When("that company's audit rows are purged the way the retention sweeper does", async function () {
    await purgeAuditRows([theCompany().tenantId]);
});

// ─── Then ────────────────────────────────────────────────────────────────────

Then('that company has {int} {string} audit row(s)', async function (count: number, action: string) {
    assert.strictEqual((await rowsOf(action)).length, count);
});

Then(
    "that row is by the Owner, from currency {string} to {string}, with the response's request id",
    async function (this: BddWorldInterface, from: string, to: string) {
        const [row] = await rowsOf('tenant_setting.updated');
        assert.strictEqual(row!.actorUserId, theCompany().ownerUserId);
        assert.deepStrictEqual(row!.before, { currencyCode: from });
        assert.deepStrictEqual(row!.after, { currencyCode: to });
        const requestId = this.response?.headers['x-request-id'] as string | undefined;
        assert.ok(requestId, 'the response carries no X-Request-Id');
        assert.strictEqual(row!.requestId, requestId);
    }
);

Then('updating that audit row is refused as append-only', async function () {
    const message = await refusal(() => fixturesPrisma.auditLog.update({ where: { id: probeId }, data: { reason: 'tampered' } }));
    assert.match(message, /audit_log is append-only: UPDATE refused/);
});

Then('deleting that audit row is refused as append-only', async function () {
    const message = await refusal(() => fixturesPrisma.auditLog.delete({ where: { id: probeId } }));
    assert.match(message, /audit_log is append-only: DELETE refused/);
});

Then('that audit row is unchanged', async function () {
    const row = await fixturesPrisma.auditLog.findUniqueOrThrow({ where: { id: probeId } });
    assert.strictEqual(row.reason, 'original');
});
