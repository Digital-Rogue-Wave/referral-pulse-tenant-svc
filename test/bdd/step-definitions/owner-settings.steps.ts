/**
 * The Owner settings route (E1 decision D8; v5.2 removed the invitation channel and moved the threshold to the Program). Reuses the signed-up company of `billing-plan.steps.ts`
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
}

const RETIRED = ['invitation_channel', 'verification_required_above', 'verification_required_above_currency'];

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
    'the settings read retention {int} and carry no invitation channel nor verification threshold',
    function (this: BddWorldInterface, retention: number) {
        const body = this.response.body as Settings & Record<string, unknown>;
        assert.strictEqual(body.retention_months, retention);
        assert.deepStrictEqual(
            RETIRED.filter((field) => field in body),
            []
        );
    }
);

Then('{string} in the outbox carries retention {int} and no retired setting', async function (eventType: string, retention: number) {
    const rows = await fixturesPrisma.eventOutbox.findMany({ where: { tenantId: theCompany().tenantId, eventType } });
    assert.strictEqual(rows.length, 1, `${eventType} rows: ${rows.length}`);
    const properties = (rows[0]!.payload as { properties: Record<string, unknown> }).properties;
    assert.strictEqual(properties.retention_months, retention);
    assert.deepStrictEqual(
        RETIRED.filter((field) => field in properties),
        []
    );
});
