/**
 * Revoking a Connection (US1.5.3). Reuses the signed-up company of `billing-plan.steps.ts` (same Before/After
 * clean-up; its connections go with the tenant). The connection comes from `connection-lifecycle.steps.ts`; the
 * revocation marker is read from the real Redis that Event Ingestion shares (F2).
 */

import { After, Then } from '@cucumber/cucumber';
import assert from 'assert';

import { RedisService } from '../../../../src/common/redis/redis.service';
import { getTestApp } from '../../support/app.bootstrap';
import { fixturesPrisma } from '../../support/db.fixtures';
import { theConnectionId } from '../common/connection-lifecycle.steps';

const markerKey = (): string => `connection-revoked:${theConnectionId()}`;
const redis = () => getTestApp().get(RedisService).getClient();

After({ tags: '@connection-revoke' }, async function () {
    if (theConnectionId()) {
        await redis().del(markerKey());
    }
});

Then('that connection is kept and marked revoked', async function () {
    const row = await fixturesPrisma.providerConnection.findUniqueOrThrow({ where: { id: theConnectionId() } });
    assert.strictEqual(row.status, 'revoked');
    assert.ok(row.revokedAt instanceof Date, 'revoked_at is not set');
});

Then('the shared revocation marker for that connection is set for {int} seconds', async function (seconds: number) {
    assert.strictEqual(await redis().get(markerKey()), '1');
    const ttl = await redis().ttl(markerKey());
    assert.ok(ttl > seconds - 10 && ttl <= seconds, `marker TTL is ${ttl}`);
});
