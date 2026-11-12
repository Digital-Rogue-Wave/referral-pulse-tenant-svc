/**
 * The Owner settings route (E1 decisions D8, D9, D11). Reuses the signed-up company of `billing-plan.steps.ts`
 * (a fresh tenant with no billing country); the route runs through the real HTTP stack and Postgres, and the
 * announcement is read from the real outbox.
 */

import { Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { randomUUID } from 'crypto';

import { theCompany } from './billing-plan.steps';
import { fixturesPrisma } from '../support/db.fixtures';
import type { BddWorldInterface } from '../support/world';

const SETTINGS = '/api/v1/tenant/settings';

interface Settings {
    invitation_channel: string;
    invitation_channel_source: string;
    retention_months: number;
    verification_required_above: number | null;
    verification_required_above_currency: string | null;
}

When('I read the Owner settings', async function (this: BddWorldInterface) {
    this.response = await this.agent().get(SETTINGS).set('Authorization', `Bearer ${this.currentToken}`);
});

When('I change the Owner settings to:', async function (this: BddWorldInterface, body: string) {
    this.response = await this.agent()
        .patch(SETTINGS)
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', `bdd-settings-${randomUUID()}`)
        .set('Content-Type', 'application/json')
        .send(body);
});

When('I send the profile update with {string} set to {string}', async function (this: BddWorldInterface, field: string, value: string) {
    this.response = await this.agent()
        .put('/api/v1/tenants')
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', `bdd-profile-${randomUUID()}`)
        .field('data', JSON.stringify({ [field]: Number(value) }));
});

Then(
    'the settings read invitation channel {string} from {string}, retention {int}, no verification threshold',
    function (this: BddWorldInterface, channel: string, source: string, retention: number) {
        const body = this.response.body as Settings;
        assert.deepStrictEqual(
            [body.invitation_channel, body.invitation_channel_source, body.retention_months, body.verification_required_above],
            [channel, source, retention, null]
        );
    }
);

Then(
    'the settings read invitation channel {string} from {string}, retention {int}, threshold {int} {string}',
    function (this: BddWorldInterface, channel: string, source: string, retention: number, amount: number, currency: string) {
        const body = this.response.body as Settings;
        assert.deepStrictEqual(
            [body.invitation_channel, body.invitation_channel_source, body.retention_months, body.verification_required_above, body.verification_required_above_currency],
            [channel, source, retention, amount, currency]
        );
    }
);

Then(
    '{string} in the outbox carries invitation channel {string}, retention {int} and threshold {int} {string}',
    async function (eventType: string, channel: string, retention: number, amount: number, currency: string) {
        const rows = await fixturesPrisma.eventOutbox.findMany({ where: { tenantId: theCompany().tenantId, eventType } });
        assert.strictEqual(rows.length, 1, `${eventType} rows: ${rows.length}`);
        const properties = (rows[0]!.payload as { properties: Record<string, unknown> }).properties;
        assert.strictEqual(properties.invitation_channel, channel);
        assert.strictEqual(properties.retention_months, retention);
        assert.strictEqual(properties.verification_required_above, amount);
        assert.strictEqual(properties.verification_required_above_currency, currency);
    }
);
