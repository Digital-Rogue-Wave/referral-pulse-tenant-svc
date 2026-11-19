/**
 * Creating, listing and retrieving Connections (US1.5.1, v5.2 API §3.16). Reuses the signed-up company of
 * `billing-plan.steps.ts` (same Before/After clean-up; its connections go with the tenant). Everything goes through
 * the real HTTP stack against the real Postgres; Keto is the BDD mock, where a subject can be denied.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import { makeActiveUserToken } from '../support/jwt.helper';
import { denyKetoFor } from '../support/nock.setup';
import type { BddWorldInterface } from '../support/world';
import { theCompany } from './billing-plan.steps';

type Connection = { id: string; provider: string; direction: string; status: string; inbound_url?: string };

/** What each provider needs on create (v5.2 API §3.16). */
export const CREDENTIALS_OF: Record<string, Record<string, string> | undefined> = {
    stripe: { signing_secret: 'whsec_bdd_0123456789abcdef' },
    paddle: { signing_secret: 'pdl_bdd_0123456789abcdef' },
    chargebee: { basic_auth_user: 'cb-bdd', basic_auth_password: 'cb-bdd-password' },
    hubspot: { signing_secret: 'hubspot_bdd_0123456789ab', api_key: 'pat-bdd-hubspot-0001' },
    wise: { api_key: 'wise-bdd-api-key-0001' },
    crm: { signing_secret: 'crm_bdd_0123456789abcdef' },
    zapier: undefined
};

export async function postConnection(world: BddWorldInterface, body: Record<string, unknown>): Promise<void> {
    world.response = await world
        .agent()
        .post('/api/v1/connections')
        .set('Authorization', `Bearer ${world.currentToken}`)
        .set('Idempotency-Key', `bdd-conn-${String(body.provider)}-${Date.now()}-${Math.random()}`)
        .send(body);
}

const connect = (world: BddWorldInterface, provider: string, extra: Record<string, unknown> = {}): Promise<void> =>
    postConnection(world, { provider, ...(CREDENTIALS_OF[provider] ? { credentials: CREDENTIALS_OF[provider] } : {}), ...extra });

const created = (world: BddWorldInterface): Connection => world.response?.body as Connection;
let lastConnectionId = '';

// ─── Given / When ────────────────────────────────────────────────────────────

When('I connect {string} with its credentials', async function (this: BddWorldInterface, provider: string) {
    await connect(this, provider);
});

When('I connect {string} as an {string} connection', async function (this: BddWorldInterface, provider: string, direction: string) {
    await connect(this, provider, { direction });
});

When('I connect {string} without credentials', async function (this: BddWorldInterface, provider: string) {
    await postConnection(this, { provider });
});

Given('I connected {string} and {string}', async function (this: BddWorldInterface, first: string, second: string) {
    for (const provider of [first, second]) {
        await connect(this, provider);
        assert.strictEqual(this.response?.status, 201, `${provider} refused: ${JSON.stringify(this.response?.body)}`);
        lastConnectionId = created(this).id;
    }
});

When('I retrieve the last connection', async function (this: BddWorldInterface) {
    this.response = await this.agent().get(`/api/v1/connections/${lastConnectionId}`).set('Authorization', `Bearer ${this.currentToken}`);
});

Given('I am a member of that company whose Keto access to connections was removed', function (this: BddWorldInterface) {
    // The token still lists every permission (a snapshot from before the change); only Keto knows it is gone.
    const userId = 'user-bdd-conn-revoked-access';
    denyKetoFor(`user:${userId}`);
    this.currentToken = makeActiveUserToken(theCompany().tenantId, userId);
});

// ─── Then ────────────────────────────────────────────────────────────────────

Then('the connection is {string} and {string}', function (this: BddWorldInterface, direction: string, status: string) {
    assert.deepStrictEqual([created(this).direction, created(this).status], [direction, status]);
});

Then('its inbound URL is absolute and ends with its own path', function (this: BddWorldInterface) {
    const { id, provider, inbound_url } = created(this);
    assert.strictEqual(inbound_url, `https://in.bdd.example/inbound/${provider}/${id}`);
});

Then('it has no inbound URL', function (this: BddWorldInterface) {
    assert.ok(!('inbound_url' in created(this)), JSON.stringify(created(this)));
});

Then('no credential is in the response', function (this: BddWorldInterface) {
    const wire = JSON.stringify(this.response?.body);
    for (const value of Object.values(CREDENTIALS_OF).flatMap((c) => Object.values(c ?? {}))) {
        assert.ok(!wire.includes(value), `credential leaked: ${wire}`);
    }
    assert.ok(!/secret_encrypted|credentials/.test(wire), wire);
});

Then('the error names the field {string}', function (this: BddWorldInterface, field: string) {
    assert.strictEqual((this.response?.body as { error?: { param?: string } }).error?.param, field);
});

Then(
    'the list holds an {string} {string} connection and a {string} {string} connection',
    function (this: BddWorldInterface, firstDirection: string, firstProvider: string, secondDirection: string, secondProvider: string) {
        const rows = (this.response?.body as { data: Connection[] }).data;
        const pairs = rows.map((row) => `${row.direction}/${row.provider}`).sort();
        assert.deepStrictEqual(pairs, [`${firstDirection}/${firstProvider}`, `${secondDirection}/${secondProvider}`].sort());
    }
);
