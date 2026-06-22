/**
 * API Key Step Definitions
 *
 * Multi-step flows that need to carry the created key id / raw secret between requests
 * (create → rotate), which the generic common.steps cannot express on their own.
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import type { BddWorldInterface } from '../support/world';

const API_KEYS = '/api/v1/api-keys';

When('I create an API key', async function (this: BddWorldInterface) {
    assert.ok(this.currentToken, 'No token set');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    this.response = await this.agent()
        .post(API_KEYS)
        .set('Authorization', `Bearer ${this.currentToken}`)
        .send({ label: 'CI key', scopes: ['tenant:read'], keyType: 'secret', expiresAt });

    const body = this.response.body as { id?: string; rawKey?: string };
    this.lastApiKeyId = body.id ?? null;
    this.lastRawKey = body.rawKey ?? null;
});

When('I rotate that API key', async function (this: BddWorldInterface) {
    assert.ok(this.lastApiKeyId, 'No API key id remembered — run "I create an API key" first');
    this.response = await this.agent().post(`${API_KEYS}/${this.lastApiKeyId}/rotate`).set('Authorization', `Bearer ${this.currentToken}`);
});

Then('the response rawKey should differ from the created key', function (this: BddWorldInterface) {
    assert.ok(this.response, 'No HTTP response');
    const body = this.response.body as { rawKey?: string };
    assert.ok(body.rawKey, 'Rotated response has no rawKey');
    assert.notStrictEqual(body.rawKey, this.lastRawKey, 'Rotated rawKey should differ from the original');
});
