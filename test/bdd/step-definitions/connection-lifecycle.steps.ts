/**
 * The Connection lifecycle (v5.2 US1.5.2–1.5.4): activation by Event Ingestion's verified callback or by an outbound
 * test, rotation with the old signing secret honoured for 24 hours, and the audited credential read. Real HTTP stack,
 * real Postgres; the provider's API is nock (Wise sandbox), Keto the BDD mock.
 */

import { After, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import nock from 'nock';

import { fixturesPrisma } from '../support/db.fixtures';
import { makeServiceToken } from '../support/jwt.helper';
import type { BddWorldInterface } from '../support/world';
import { CREDENTIALS_OF, postConnection } from './connection-create.steps';

const WISE_SANDBOX = 'https://api.sandbox.transferwise.tech';
const ROTATED_SECRET = 'whsec_bdd_rotated_0123456789';

let connectionId = '';
export const theConnectionId = (): string => connectionId;

After({ tags: '@connection-lifecycle or @connection-revoke' }, function () {
    connectionId = '';
});

const outboxRows = async (eventType: string) =>
    (await fixturesPrisma.eventOutbox.findMany({ where: { eventType } })).filter((row) => JSON.stringify(row.payload).includes(connectionId));

Given('that company has a {string} connection', async function (this: BddWorldInterface, provider: string) {
    await postConnection(this, { provider, credentials: CREDENTIALS_OF[provider] });
    assert.strictEqual(this.response?.status, 201, `connection refused: ${JSON.stringify(this.response?.body)}`);
    connectionId = (this.response?.body as { id: string }).id;
});

Given("Wise accepts that connection's api key", function () {
    nock(WISE_SANDBOX).get('/v1/profiles').matchHeader('authorization', `Bearer ${CREDENTIALS_OF.wise!.api_key}`).reply(200, []);
});

When('I revoke that connection', async function (this: BddWorldInterface) {
    this.response = await this.agent().delete(`/api/v1/connections/${connectionId}`).set('Authorization', `Bearer ${this.currentToken}`);
});

When('Event Ingestion reports a verified callback for that connection', async function (this: BddWorldInterface) {
    this.response = await this.agent()
        .post(`/api/v1/internal/connections/${connectionId}/verified`)
        .set('Authorization', `Bearer ${makeServiceToken('ingestion-svc')}`);
});

When("I rotate that connection's signing secret", async function (this: BddWorldInterface) {
    this.response = await this.agent()
        .post(`/api/v1/connections/${connectionId}/rotate`)
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', `bdd-rotate-${Date.now()}`)
        .send({ credentials: { signing_secret: ROTATED_SECRET } });
});

When('I test that connection', async function (this: BddWorldInterface) {
    this.response = await this.agent()
        .post(`/api/v1/connections/${connectionId}/test`)
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', `bdd-test-${Date.now()}`);
});

When("the payout worker reads that connection's credential", async function (this: BddWorldInterface) {
    this.response = await this.agent()
        .get(`/api/v1/internal/connections/${connectionId}/credential`)
        .set('Authorization', `Bearer ${makeServiceToken('payout-worker')}`);
});

Then('that connection is {string} in the database', async function (status: string) {
    const row = await fixturesPrisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } });
    assert.strictEqual(row.status, status);
    assert.ok(row.lastVerifiedAt instanceof Date, 'last_verified_at is not set');
});

Then('{string} is in the outbox for that connection', async function (eventType: string) {
    assert.ok((await outboxRows(eventType)).length > 0, `no ${eventType} outbox row for ${connectionId}`);
});

Then('{string} is in the outbox for that connection once', async function (eventType: string) {
    assert.strictEqual((await outboxRows(eventType)).length, 1);
});

Then('Event Ingestion gets the new secret and the old one for 24 hours', async function (this: BddWorldInterface) {
    const response = await this.agent()
        .get(`/api/v1/internal/connections/stripe/${connectionId}`)
        .set('Authorization', `Bearer ${makeServiceToken('ingestion-svc')}`);
    const body = response.body as { signing_secret: string; previous_signing_secret: string; previous_secret_valid_until: string };
    assert.strictEqual(body.signing_secret, ROTATED_SECRET);
    assert.strictEqual(body.previous_signing_secret, CREDENTIALS_OF.stripe!.signing_secret);
    const hours = (new Date(body.previous_secret_valid_until).getTime() - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24, `old secret honoured for ${hours} h`);
});

Then('the test passed and the connection is {string}', function (this: BddWorldInterface, status: string) {
    assert.deepStrictEqual(this.response?.body, { ...(this.response?.body as object), ok: true, status, failure: null });
});

Then("the credential is that connection's api key", function (this: BddWorldInterface) {
    assert.deepStrictEqual((this.response?.body as { credentials: unknown }).credentials, { api_key: CREDENTIALS_OF.wise!.api_key });
});

Then('the audit log records {string} by {string}', async function (action: string, actor: string) {
    const rows = await fixturesPrisma.auditLog.findMany({ where: { action, targetId: connectionId } });
    assert.deepStrictEqual(
        rows.map((row) => row.actorUserId),
        [actor]
    );
});
