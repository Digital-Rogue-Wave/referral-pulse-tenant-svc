/**
 * Company verification (v5.2 US1.6.1, US1.6.2, US1.6.4). Reuses the signed-up company of `billing-plan.steps.ts`. The
 * Owner and the Super Admin go through the real HTTP stack and Postgres; the KYB provider is the fake adapter, its
 * callback is applied as Event Ingestion's normalised result would be, and Temporal is `temporal.fake.ts`.
 */

import { Before, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import { CompanyVerificationService } from '../../../../src/features/verification/company-verification.service';
import { getTestApp } from '../../support/app.bootstrap';
import { fixturesPrisma } from '../../support/db.fixtures';
import { makePlatformToken } from '../../support/jwt.helper';
import { fakeAccountVerificationGateway } from '../../support/temporal.fake';
import type { BddWorldInterface } from '../../support/world';
import { theCompany } from './billing-plan.steps';

let verificationId = '';

Before({ tags: '@company-verification' }, function () {
    verificationId = '';
    fakeAccountVerificationGateway.reset();
});

async function openSession(world: BddWorldInterface): Promise<void> {
    world.response = await world
        .agent()
        .post('/api/v1/verification')
        .set('Authorization', `Bearer ${world.currentToken}`)
        .set('Idempotency-Key', `bdd-kyb-${Date.now()}-${Math.random()}`);
    verificationId = (world.response.body as { verification_id?: string }).verification_id ?? verificationId;
}

const providerCallsBack = (): Promise<void> =>
    getTestApp().get(CompanyVerificationService).applyProviderResult({
        tenantId: theCompany().tenantId,
        verificationId,
        provider: 'fake',
        outcome: 'verified',
        reason: null,
        retryAllowed: false,
        providerReference: 'fake-applicant-1',
        labels: []
    });

async function decide(world: BddWorldInterface, decision: 'approve' | 'reject', reason?: string): Promise<void> {
    world.response = await world
        .agent()
        .post(`/api/v1/admin/verifications/${verificationId}/${decision}`)
        .set('Authorization', `Bearer ${makePlatformToken()}`)
        .set('Idempotency-Key', `bdd-kyb-decide-${Date.now()}-${Math.random()}`)
        .send(reason === undefined ? {} : { reason });
}

async function verificationRead(world: BddWorldInterface): Promise<{ status: string; verification: { reason: string | null } | null }> {
    const response = await world.agent().get('/api/v1/verification').set('Authorization', `Bearer ${world.currentToken}`);
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    return response.body as { status: string; verification: { reason: string | null } | null };
}

// ─── Given / When ────────────────────────────────────────────────────────────

When('I open a company verification session', async function (this: BddWorldInterface) {
    await openSession(this);
});

Given('I opened a company verification session', async function (this: BddWorldInterface) {
    await openSession(this);
    assert.strictEqual(this.response?.status, 200, JSON.stringify(this.response?.body));
});

When('the KYB provider calls back for that session', async function () {
    await providerCallsBack();
});

Given("the company's verification is under review", async function (this: BddWorldInterface) {
    await openSession(this);
    await providerCallsBack();
});

When('a Super Admin verifies that case with the reason {string}', async function (this: BddWorldInterface, reason: string) {
    await decide(this, 'approve', reason);
});

When('a Super Admin verifies that case with no reason', async function (this: BddWorldInterface) {
    await decide(this, 'approve');
});

When('a Super Admin rejects that case with the reason {string}', async function (this: BddWorldInterface, reason: string) {
    await decide(this, 'reject', reason);
});

// ─── Then ────────────────────────────────────────────────────────────────────

Then('the session answer says {string} with a provider link', function (this: BddWorldInterface, status: string) {
    const body = this.response?.body as { status: string; provider_url: string };
    assert.strictEqual(body.status, status);
    assert.ok(body.provider_url.includes(encodeURIComponent(`${theCompany().tenantId}:${verificationId}`)), body.provider_url);
});

Then("the company's verification reads {string}", async function (this: BddWorldInterface, status: string) {
    assert.strictEqual((await verificationRead(this)).status, status);
});

Then("the company's verification reads {string} with the reason {string}", async function (this: BddWorldInterface, status: string, reason: string) {
    const read = await verificationRead(this);
    assert.deepStrictEqual([read.status, read.verification?.reason], [status, reason]);
});

Then('{string} is in the outbox with status {string} decided by {string}', async function (eventType: string, status: string, decidedBy: string) {
    const rows = await fixturesPrisma.eventOutbox.findMany({ where: { eventType, tenantId: theCompany().tenantId } });
    const properties = rows.map((row) => (row.payload as { properties: Record<string, unknown> }).properties);
    assert.ok(
        properties.some((p) => p.verification_status === status && p.decided_by === decidedBy),
        `no ${eventType} ${status} by ${decidedBy}: ${JSON.stringify(properties)}`
    );
});

Then('the account_verification workflow was started and its id stored on the case', async function () {
    assert.deepStrictEqual(fakeAccountVerificationGateway.started, [{ tenantId: theCompany().tenantId, verificationId }]);
    const row = await fixturesPrisma.tenantVerification.findUniqueOrThrow({ where: { id: verificationId } });
    assert.deepStrictEqual(
        [row.status, row.temporalWorkflowId, row.temporalRunId],
        ['pending_review', `account-verification-${verificationId}`, `run-${verificationId}`]
    );
});

Then('the account_verification workflow was signalled {string}', function (status: string) {
    assert.deepStrictEqual(fakeAccountVerificationGateway.signalled, [{ workflowId: `account-verification-${verificationId}`, status }]);
});

Then('the audit log records {string} by {string} with the reason {string}', async function (action: string, actor: string, reason: string) {
    const rows = await fixturesPrisma.auditLog.findMany({ where: { action, tenantId: theCompany().tenantId, actorUserId: actor } });
    assert.ok(
        rows.some((row) => row.reason === reason),
        `audit rows: ${JSON.stringify(rows.map((r) => [r.actorUserId, r.reason]))}`
    );
});
