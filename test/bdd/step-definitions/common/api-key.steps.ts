import { When } from '@cucumber/cucumber';
import assert from 'assert';
import { randomUUID } from 'crypto';

import type { BddWorldInterface } from '../../support/world';

export const API_KEYS = '/api/v1/api-keys';

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
