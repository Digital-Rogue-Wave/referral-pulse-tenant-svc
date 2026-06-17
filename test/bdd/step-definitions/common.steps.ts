/**
 * Common Step Definitions
 *
 * HTTP request steps and generic assertion steps reused across all features.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import type { BddWorldInterface } from '../support/world';

// ─── Application health ───────────────────────────────────────────────────────

Given('the application is running', async function (this: BddWorldInterface) {
    // The app is started in BeforeAll — just verify it's available
    const app = this.agent();
    assert.ok(app, 'NestJS test application is not running');
});

// ─── HTTP request steps ───────────────────────────────────────────────────────

When('I send a {word} request to {string} without any token', async function (this: BddWorldInterface, method: string, path: string) {
    this.response = await this.agent()[method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](path);
});

When('I send a {word} request to {string} with that token', async function (this: BddWorldInterface, method: string, path: string) {
    assert.ok(this.currentToken, 'No token set — use a "Given I have a ... token" step first');

    this.response = await this.agent()
        [method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](path)
        .set('Authorization', `Bearer ${this.currentToken}`);
});

When('I send a {word} request to {string} with body:', async function (this: BddWorldInterface, method: string, path: string, docString: string) {
    assert.ok(this.currentToken, 'No token set — use a "Given I have a ... token" step first');

    const body: unknown = JSON.parse(docString);

    this.response = await this.agent()
        [method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](path)
        .set('Authorization', `Bearer ${this.currentToken}`)
        .set('Content-Type', 'application/json')
        .send(body);
});

// ─── Status code assertions ───────────────────────────────────────────────────

Then('the response status should be {int}', function (this: BddWorldInterface, expectedStatus: number) {
    assert.ok(this.response, 'No HTTP response — run a When step first');
    assert.strictEqual(
        this.response.status,
        expectedStatus,
        `Expected status ${expectedStatus} but got ${this.response.status}. Body: ${JSON.stringify(this.response.body)}`
    );
});

Then('the response status is not {int}', function (this: BddWorldInterface, unexpectedStatus: number) {
    assert.ok(this.response, 'No HTTP response — run a When step first');
    assert.notStrictEqual(
        this.response.status,
        unexpectedStatus,
        `Expected status to NOT be ${unexpectedStatus}. Body: ${JSON.stringify(this.response.body)}`
    );
});

// ─── Response body assertions ─────────────────────────────────────────────────

Then('the response should be an array', function (this: BddWorldInterface) {
    assert.ok(this.response, 'No HTTP response');
    assert.ok(Array.isArray(this.response.body), `Expected response body to be an array, got: ${JSON.stringify(this.response.body)}`);
});

Then('the response should be a non-empty array', function (this: BddWorldInterface) {
    assert.ok(this.response, 'No HTTP response');
    assert.ok(Array.isArray(this.response.body), `Expected array, got: ${typeof this.response.body}`);
    assert.ok(this.response.body.length > 0, 'Expected non-empty array but got []');
});

Then('each item in the response should have a {string} field', function (this: BddWorldInterface, field: string) {
    assert.ok(this.response, 'No HTTP response');
    assert.ok(Array.isArray(this.response.body), 'Response body is not an array');

    const items = this.response.body as Record<string, unknown>[];
    for (const item of items) {
        assert.ok(field in item, `Expected each item to have "${field}" but found: ${JSON.stringify(item)}`);
    }
});

Then('the response should contain a {string} field', function (this: BddWorldInterface, field: string) {
    assert.ok(this.response, 'No HTTP response');
    const body = this.response.body as Record<string, unknown>;
    assert.ok(field in body, `Expected response to contain field "${field}". Body: ${JSON.stringify(body)}`);
});

Then('the response should contain a {string} field with value {string}', function (this: BddWorldInterface, field: string, expectedValue: string) {
    assert.ok(this.response, 'No HTTP response');
    const body = this.response.body as Record<string, unknown>;
    assert.ok(field in body, `Expected response to contain field "${field}". Body: ${JSON.stringify(body)}`);
    assert.strictEqual(String(body[field]), expectedValue, `Expected "${field}" to be "${expectedValue}" but got "${String(body[field])}"`);
});

Then('the response should contain errorCode {string}', function (this: BddWorldInterface, expectedCode: string) {
    assert.ok(this.response, 'No HTTP response');
    const body = this.response.body as Record<string, unknown>;
    assert.strictEqual(
        body['errorCode'],
        expectedCode,
        `Expected errorCode "${expectedCode}" but got "${String(body['errorCode'])}". Body: ${JSON.stringify(body)}`
    );
});
