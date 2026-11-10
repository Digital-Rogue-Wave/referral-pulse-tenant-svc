/**
 * Creating and listing provider connections (US1.5.1). Reuses the signed-up company of `billing-plan.steps.ts`
 * (same Before/After clean-up; its connections go with the tenant). Everything goes through the real HTTP stack
 * against the real Postgres (F2); Keto is the BDD mock, where a subject can be denied (F3).
 */

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import { makeActiveUserToken } from '../support/jwt.helper';
import { denyKetoFor } from '../support/nock.setup';
import type { BddWorldInterface } from '../support/world';
import { theCompany } from './billing-plan.steps';

type Connection = { id: string; provider: string; connection_type: string; receiver_url: string };

async function connect(world: BddWorldInterface, provider: string, connectionType?: string): Promise<void> {
    world.response = await world
        .agent()
        .post('/api/v1/connections')
        .set('Authorization', `Bearer ${world.currentToken}`)
        .set('Idempotency-Key', `bdd-conn-${provider}-${Date.now()}`)
        .send({ provider, ...(connectionType ? { connection_type: connectionType } : {}), signing_secret: `secret_${provider}_0123456789abcdef` });
}

const created = (world: BddWorldInterface): Connection => world.response?.body as Connection;

// ─── Given / When ────────────────────────────────────────────────────────────

When('I connect {string} with no connection type', async function (this: BddWorldInterface, provider: string) {
    await connect(this, provider);
});

When('I connect {string} as a {string} connection', async function (this: BddWorldInterface, provider: string, connectionType: string) {
    await connect(this, provider, connectionType);
});

Given('I connected {string} and {string}', async function (this: BddWorldInterface, first: string, second: string) {
    for (const provider of [first, second]) {
        await connect(this, provider);
        assert.strictEqual(this.response?.status, 201, `${provider} refused: ${JSON.stringify(this.response?.body)}`);
    }
});

Given('I am a member of that company whose Keto access to connections was removed', function (this: BddWorldInterface) {
    // The token still lists every permission (a snapshot from before the change); only Keto knows it is gone.
    const userId = 'user-bdd-conn-revoked-access';
    denyKetoFor(`user:${userId}`);
    this.currentToken = makeActiveUserToken(theCompany().tenantId, userId);
});

// ─── Then ────────────────────────────────────────────────────────────────────

Then('the connection is a {string} connection', function (this: BddWorldInterface, connectionType: string) {
    assert.strictEqual(created(this).connection_type, connectionType);
});

Then('its receiver URL is absolute and ends with its own path \\(F4)', function (this: BddWorldInterface) {
    const { id, provider, receiver_url } = created(this);
    assert.strictEqual(receiver_url, `https://in.bdd.example/inbound/${provider}/${id}`);
});

Then('the error names the field {string}', function (this: BddWorldInterface, field: string) {
    assert.strictEqual((this.response?.body as { error?: { param?: string } }).error?.param, field);
});

Then(
    'the list holds a {string} {string} connection and a {string} {string} connection',
    function (this: BddWorldInterface, firstType: string, firstProvider: string, secondType: string, secondProvider: string) {
        const rows = (this.response?.body as { data: Connection[] }).data;
        const pairs = rows.map((row) => `${row.connection_type}/${row.provider}`).sort();
        assert.deepStrictEqual(pairs, [`${firstType}/${firstProvider}`, `${secondType}/${secondProvider}`].sort());
    }
);
