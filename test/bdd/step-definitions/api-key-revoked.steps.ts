/**
 * Revoked API keys stay visible (US1.4.2 F1, E1 decision D6). Reuses the signed-up company of
 * `billing-plan.steps.ts` (a fresh tenant, so no key limit from other scenarios) and the create / rotate
 * steps of `api-key.steps.ts`; everything goes through the real HTTP stack and Postgres.
 */

import { Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { randomUUID } from 'crypto';

import { theCompany } from './billing-plan.steps';
import type { BddWorldInterface } from '../support/world';

const API_KEYS = '/api/v1/api-keys';

interface ListedKey {
    id: string;
    revoked_at: string | null;
    revoked_by: string | null;
    revocation_reason: string | null;
}

async function listed(world: BddWorldInterface, query: string): Promise<ListedKey[]> {
    const response = await world.agent().get(`${API_KEYS}${query}`).set('Authorization', `Bearer ${world.currentToken}`);
    assert.strictEqual(response.status, 200, `list ${query}: ${response.status} ${JSON.stringify(response.body)}`);
    return (response.body as { data: ListedKey[] }).data;
}

When('I revoke that API key because {string}', async function (this: BddWorldInterface, reason: string) {
    this.response = await this.agent()
        .delete(`${API_KEYS}/${this.lastApiKeyId}`)
        .query({ reason })
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', `bdd-${randomUUID()}`);
});

When('I read that API key', async function (this: BddWorldInterface) {
    this.response = await this.agent().get(`${API_KEYS}/${this.lastApiKeyId}`).set('Authorization', `Bearer ${this.currentToken}`);
});

Then('the API key list {string} does not hold that key', async function (this: BddWorldInterface, query: string) {
    const keys = await listed(this, query === 'without a status' ? '' : query);
    assert.ok(!keys.some((key) => key.id === this.lastApiKeyId), 'the revoked key is in the live list');
});

Then(
    'the API key list {string} holds that key, revoked by me because {string}',
    async function (this: BddWorldInterface, query: string, reason: string) {
        const key = (await listed(this, query)).find((candidate) => candidate.id === this.lastApiKeyId);
        assert.ok(key, `the revoked key is missing from ${query}`);
        assert.ok(key.revoked_at, 'revoked_at is not set');
        assert.strictEqual(key.revoked_by, theCompany().ownerUserId);
        assert.strictEqual(key.revocation_reason, reason);
    }
);
