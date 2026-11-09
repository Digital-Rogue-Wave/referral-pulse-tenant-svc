/**
 * Invoice history (US1.8.3). Reuses the signed-up company of `billing-plan.steps.ts` (same Before/After
 * clean-up). Stripe's invoices are set in `stripe.fake.ts` in Stripe's own shape (cents) and read through
 * the real `StripeService` mapping, so these scenarios prove the amounts the Owner receives.
 */

import { Before, Given, Then } from '@cucumber/cucumber';
import assert from 'assert';

import { ALL_PERMISSIONS } from '../../../src/common/auth/authz/permission-catalog';
import { makeActiveUserToken } from '../support/jwt.helper';
import { stripeInvoices } from '../support/stripe.fake';
import type { BddWorldInterface } from '../support/world';
import { theCompany } from './billing-plan.steps';

Before({ tags: '@invoice-history' }, function () {
    stripeInvoices.list = [];
    stripeInvoices.upcoming = null;
});

const DAY = 86_400;

function stripeInvoice(n: number, cents: number, status: string): Record<string, unknown> {
    const created = Math.floor(Date.now() / 1000) - n * 30 * DAY;
    return {
        id: `in_bdd_${n}`,
        object: 'invoice',
        number: `BDD-000${n}`,
        status,
        currency: 'eur',
        amount_due: cents,
        amount_paid: status === 'paid' ? cents : 0,
        created,
        period_start: created,
        period_end: created + 30 * DAY,
        hosted_invoice_url: `https://invoice.stripe.com/i/bdd_${n}`,
        invoice_pdf: `https://pay.stripe.com/invoice/bdd_${n}/pdf`
    };
}

// ─── Given ───────────────────────────────────────────────────────────────────

Given('Stripe holds a paid invoice of {int} cents in euros for that company', function (cents: number) {
    stripeInvoices.list = [stripeInvoice(1, cents, 'paid')];
});

Given('Stripe holds {int} invoices for that company', function (count: number) {
    stripeInvoices.list = Array.from({ length: count }, (_, i) => stripeInvoice(i + 1, 2500, 'paid'));
});

Given("Stripe's next invoice for that company is {int} cents in euros", function (cents: number) {
    stripeInvoices.upcoming = { object: 'invoice', amount_due: cents, currency: 'eur', next_payment_attempt: null };
});

Given('I am a member of that billing company without billing:read', function (this: BddWorldInterface) {
    const perms = ALL_PERMISSIONS.filter((p) => p !== 'billing:read');
    this.currentToken = makeActiveUserToken(theCompany().tenantId, 'user-bdd-no-billing-read', [...perms]);
});

// ─── Then ────────────────────────────────────────────────────────────────────

type InvoiceWire = Record<string, unknown>;
const page = (world: BddWorldInterface): { data: InvoiceWire[]; has_more: boolean; next_cursor: string | null } =>
    world.response?.body as { data: InvoiceWire[]; has_more: boolean; next_cursor: string | null };

Then('the invoice page is empty', function (this: BddWorldInterface) {
    assert.deepStrictEqual(this.response?.body, { data: [], has_more: false, next_cursor: null, prev_cursor: null });
});

Then('the first invoice is due {int} and paid {int} in {string}', function (this: BddWorldInterface, due: number, paid: number, currency: string) {
    const invoice = page(this).data[0]!;
    assert.strictEqual(invoice.amount_due, due);
    assert.strictEqual(invoice.amount_paid, paid);
    assert.strictEqual(invoice.currency, currency);
    assert.ok(Number.isInteger(invoice.amount_due), 'amount_due must be an integer in minor units');
});

Then('the first invoice links its PDF and its hosted page', function (this: BddWorldInterface) {
    const invoice = page(this).data[0]!;
    assert.match(String(invoice.invoice_pdf_url), /^https:\/\/pay\.stripe\.com\/invoice\/.+\/pdf$/);
    assert.match(String(invoice.hosted_invoice_url), /^https:\/\/invoice\.stripe\.com\/i\//);
});

Then('the page holds {int} invoices, has more, and its next cursor is {string}', function (this: BddWorldInterface, count: number, cursor: string) {
    const body = page(this);
    assert.strictEqual(body.data.length, count);
    assert.strictEqual(body.has_more, true);
    assert.strictEqual(body.next_cursor, cursor);
});

Then('the upcoming invoice is due {int} in {string}', function (this: BddWorldInterface, due: number, currency: string) {
    const body = this.response?.body as { amount_due: number; currency: string };
    assert.strictEqual(body.amount_due, due);
    assert.strictEqual(body.currency, currency);
});
