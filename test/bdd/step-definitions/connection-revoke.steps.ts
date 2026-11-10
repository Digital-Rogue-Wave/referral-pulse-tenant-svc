/**
 * Revoking a provider connection (US1.5.3). Reuses the signed-up company of `billing-plan.steps.ts` (same
 * Before/After clean-up; its connections go with the tenant). The connection is created and revoked through the
 * real HTTP stack against the real Postgres (F3), and the revocation marker is read from the real Redis that
 * Event Ingestion shares (F2).
 */

import { After, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import { RedisService } from '../../../src/common/redis/redis.service';
import { getTestApp } from '../support/app.bootstrap';
import { fixturesPrisma } from '../support/db.fixtures';
import type { BddWorldInterface } from '../support/world';

let connectionId = '';
const markerKey = (): string => `connection-revoked:${connectionId}`;
const redis = () => getTestApp().get(RedisService).getClient();

After({ tags: '@connection-revoke' }, async function () {
    if (connectionId) {
        await redis().del(markerKey());
    }
    connectionId = '';
});

Given('that company has a live {string} billing connection', async function (this: BddWorldInterface, provider: string) {
    const response = await this.agent()
        .post('/api/v1/connections')
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', `bdd-conn-${Date.now()}`)
        .send({ provider, connection_type: 'billing', name: `bdd ${provider}`, signing_secret: 'whsec_bdd_0123456789abcdef' });
    assert.strictEqual(response.status, 201, `connection refused: ${JSON.stringify(response.body)}`);
    connectionId = (response.body as { id: string }).id;
});

When('I revoke that connection', async function (this: BddWorldInterface) {
    this.response = await this.agent().delete(`/api/v1/connections/${connectionId}`).set('Authorization', `Bearer ${this.currentToken}`);
});

Then('that connection is kept, disabled and marked revoked', async function () {
    const row = await fixturesPrisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } });
    assert.strictEqual(row.enabled, false);
    assert.ok(row.revokedAt instanceof Date, 'revoked_at is not set');
});

Then('{string} is in the outbox for that connection', async function (eventType: string) {
    const rows = await fixturesPrisma.eventOutbox.findMany({ where: { eventType } });
    assert.ok(
        rows.some((row) => JSON.stringify(row.payload).includes(connectionId)),
        `no ${eventType} outbox row for ${connectionId}`
    );
});

Then('the shared revocation marker for that connection is set for {int} seconds', async function (seconds: number) {
    assert.strictEqual(await redis().get(markerKey()), '1');
    const ttl = await redis().ttl(markerKey());
    assert.ok(ttl > seconds - 10 && ttl <= seconds, `marker TTL is ${ttl}`);
});
