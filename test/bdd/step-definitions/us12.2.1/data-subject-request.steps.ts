/**
 * Data-subject requests of every type (US12.2.1, E1 decision D4). Reuses the signed-up company of
 * `billing-plan.steps.ts`; the request goes through the real HTTP stack into the real Postgres, whose
 * `dsr_requests_status_check` is what refused the old `accepted` status with a 500.
 */

import { After, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import { theCompany } from '../common/billing-plan.steps';
import { fixturesPrisma } from '../../support/db.fixtures';
import type { BddWorldInterface } from '../../support/world';

let requestId = '';

After({ tags: '@data-subject-request' }, async function () {
    await fixturesPrisma.dsrRequest.deleteMany({ where: { tenantId: theCompany().tenantId } });
    requestId = '';
});

When('I submit a {string} data-subject request', async function (this: BddWorldInterface, requestType: string) {
    this.response = await this.agent()
        .post('/api/v1/data-subject-requests')
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Idempotency-Key', `bdd-dsr-${requestType}-${Date.now()}`)
        .send({ request_type: requestType, subject_email: `subject-${Date.now()}@example.test` });
    requestId = (this.response.body as { id?: string }).id ?? '';
});

Then(
    'the request is answered as {string}, {string}, due within {int} days',
    function (this: BddWorldInterface, requestType: string, status: string, days: number) {
        const body = this.response.body as { request_type: string; status: string; due_at: string };
        assert.strictEqual(body.request_type, requestType);
        assert.strictEqual(body.status, status);
        const dueInDays = (new Date(body.due_at).getTime() - Date.now()) / 86_400_000;
        assert.ok(dueInDays > days - 1 && dueInDays <= days, `due in ${dueInDays.toFixed(2)} days`);
    }
);

Then('the stored request reads {string}', async function (status: string) {
    const row = await fixturesPrisma.dsrRequest.findUniqueOrThrow({ where: { id: requestId } });
    assert.strictEqual(row.status, status);
});

Then('{string} is in the outbox for that request', async function (eventType: string) {
    const rows = await fixturesPrisma.eventOutbox.findMany({ where: { eventType } });
    assert.ok(
        rows.some((row) => JSON.stringify(row.payload).includes(requestId)),
        `no ${eventType} outbox row for ${requestId}`
    );
});
