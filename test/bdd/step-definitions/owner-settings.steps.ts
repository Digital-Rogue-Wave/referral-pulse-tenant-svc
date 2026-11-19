/**
 * The Owner settings route (E1 decisions D8, D11; v5.2 removed the invitation channel). Reuses the signed-up company of `billing-plan.steps.ts`
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
    'the settings read retention {int}, no verification threshold, and no invitation channel',
    function (this: BddWorldInterface, retention: number) {
        const body = this.response.body as Settings & Record<string, unknown>;
        assert.deepStrictEqual([body.retention_months, body.verification_required_above], [retention, null]);
        assert.ok(!('invitation_channel' in body), 'the settings still carry invitation_channel');
    }
);

Then(
    'the settings read retention {int}, threshold {int} {string}',
    function (this: BddWorldInterface, retention: number, amount: number, currency: string) {
        const body = this.response.body as Settings;
        assert.deepStrictEqual(
            [body.retention_months, body.verification_required_above, body.verification_required_above_currency],
            [retention, amount, currency]
        );
    }
);

Then(
    '{string} in the outbox carries retention {int}, threshold {int} {string} and no invitation channel',
    async function (eventType: string, retention: number, amount: number, currency: string) {
        const rows = await fixturesPrisma.eventOutbox.findMany({ where: { tenantId: theCompany().tenantId, eventType } });
        assert.strictEqual(rows.length, 1, `${eventType} rows: ${rows.length}`);
        const properties = (rows[0]!.payload as { properties: Record<string, unknown> }).properties;
        assert.ok(!('invitation_channel' in properties), 'the event still carries invitation_channel');
        assert.strictEqual(properties.retention_months, retention);
        assert.strictEqual(properties.verification_required_above, amount);
        assert.strictEqual(properties.verification_required_above_currency, currency);
    }
);
