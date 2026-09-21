/**
 * API Key Step Definitions
 *
 * Multi-step flows that need to carry the created key id / raw secret between requests
 * (create → rotate), which the generic common.steps cannot express on their own.
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { randomUUID } from 'crypto';
import type { BddWorldInterface } from '../support/world';

const API_KEYS = '/api/v1/api-keys';

When('I create an API key', async function (this: BddWorldInterface) {
    assert.ok(this.currentToken, 'No token set');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    this.response = await this.agent()
        .post(API_KEYS)
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', `bdd-${randomUUID()}`)
        .send({ label: 'CI key', key_type: 'secret', expires_at: expiresAt });

    const body = this.response.body as { id?: string; raw_key?: string };
    this.lastApiKeyId = body.id ?? null;
    this.lastRawKey = body.raw_key ?? null;
});

When('I rotate that API key', async function (this: BddWorldInterface) {
    assert.ok(this.lastApiKeyId, 'No API key id remembered — run "I create an API key" first');
    this.response = await this.agent()
        .post(`${API_KEYS}/${this.lastApiKeyId}/rotate`)
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', `bdd-${randomUUID()}`);
});

Then('the response rawKey should differ from the created key', function (this: BddWorldInterface) {
    assert.ok(this.response, 'No HTTP response');
    const body = this.response.body as { raw_key?: string };
    assert.ok(body.raw_key, 'Rotated response has no raw_key');
    assert.notStrictEqual(body.raw_key, this.lastRawKey, 'Rotated raw_key should differ from the original');
});

Then('the response should be the same API key as the first attempt', function (this: BddWorldInterface) {
    assert.ok(this.response, 'No HTTP response');
    assert.strictEqual((this.response.body as { id?: string }).id, this.lastApiKeyId);
    assert.strictEqual(this.response.headers['idempotent-replayed'], 'true');
});

When('I create an API key with Idempotency-Key {string}', async function (this: BddWorldInterface, key: string) {
    this.response = await this.agent()
        .post(API_KEYS)
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', key)
        .send({ label: 'Retried key', key_type: 'secret' });
    const body = this.response.body as { id?: string };
    this.lastApiKeyId ??= body.id ?? null;
});
