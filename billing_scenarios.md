# Billing Verification Playbook (Real Stripe + Dashboard + CLI)

This guide is for **local dev** in **Stripe test mode** where you want to:

- Create a **real** Stripe Checkout Session (so you can pay with test cards like `4242 4242 4242 4242`)
- See **Customers / Subscriptions / Invoices / Events** in the Stripe Dashboard
- Verify the service updates local billing state via webhooks
- Exercise basic usage tracking + plan limits

## 1) Preconditions

### Service + Swagger

- **API base**: `http://localhost:5001/api`
- **Swagger**: `http://localhost:5001/tenant-docs`

### Stripe env vars required

In `.env`:

- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...` (from `stripe listen` output)
- `STRIPE_SUCCESS_URL=http://localhost:5001/success`
- `STRIPE_CANCEL_URL=http://localhost:5001/cancel`

And price IDs mapped to your plans:

- `STRIPE_FREE_PRICE_ID=price_...`
- `STRIPE_STARTER_PRICE_ID=price_...`
- `STRIPE_GROWTH_PRICE_ID=price_...`
- `STRIPE_ENTERPRISE_PRICE_ID=price_...`

**Important**: these must be **real Price IDs** in your Stripe test account, and they must be **recurring** prices (because checkout is `mode=subscription`).

### Webhook forwarding (Stripe CLI)

Your service expects the Stripe webhook at:

- `POST http://localhost:5001/webhooks/stripe`

Run:

```powershell
stripe listen --forward-to http://localhost:5001/webhooks/stripe
```

Copy the printed signing secret into:

- `STRIPE_WEBHOOK_SECRET=whsec_...`

Then restart the service.

## 2) Tenant context (required for all test endpoints)

All `/api/test/*` endpoints require tenant context.

Provide it via header:

- `tenant-id: <tenant_uuid>`

In Swagger, add:

- **Authorize** with your Bearer token
- Add `tenant-id` header for each request (or set it globally in Swagger if you use a plugin)

## 3) Path Scenario A — New paid subscription via Stripe Checkout (4242…)

### Step A1 — Create a real Checkout Session URL

Swagger:

- `POST /api/test/stripe/checkout-session`

Body:

```json
{
  "plan": "starter"
}
```

Headers:

- `Authorization: Bearer <jwt>`
- `tenant-id: <tenant_uuid>`

Expected response:

- `checkoutUrl` (open it in a browser)
- `sessionId`

### Step A2 — Complete payment in Stripe Checkout using test card

Use a Stripe test card:

- Card: `4242 4242 4242 4242`
- Any future expiry
- Any CVC
- Any ZIP

After success, Stripe will send webhooks to your app (via Stripe CLI forward).

### Step A3 — Confirm in Stripe Dashboard

In **Stripe Dashboard (Test mode)**:

- **Customers**: new customer created
- **Subscriptions**: new subscription created
- **Events**: you should see `checkout.session.completed` and invoice events

### Step A4 — Confirm in your service

Swagger:

- `GET /api/test/billing/subscription`
- `GET /api/test/billing/entity`
- `GET /api/test/tenant/payment-status`
- `GET /api/test/billing/events?limit=20`

Expected:

- `subscriptionStatus` should become `ACTIVE`
- `plan` should match what you checked out with
- `stripeCustomerId` / `stripeSubscriptionId` should be populated
- `paymentStatus` should be `active`

## 4) Path Scenario B — Upgrade subscription

Precondition: Scenario A completed and subscription is active.

Swagger:

- `POST /api/test/billing/upgrade`

Body:

```json
{
  "targetPlan": "growth"
}
```

Then verify:

- `GET /api/test/billing/subscription`
- `GET /api/test/billing/entity`

And in Stripe Dashboard:

- subscription item price changes to the Growth price
- a proration invoice should be created and (in most test cases) automatically paid

## 5) Path Scenario C — Schedule downgrade

Swagger:

- `POST /api/test/billing/downgrade`

Body:

```json
{
  "targetPlan": "starter"
}
```

Verify:

- `GET /api/test/billing/subscription`
- `GET /api/test/billing/entity`

Look for:

- `pendingDowngradePlan`
- `downgradeScheduledAt`

In Stripe Dashboard:

- subscription remains on the current plan until the next billing period

After the current billing period ends (and the next cycle invoice is paid):

- the subscription item price should change to the downgraded plan
- `pendingDowngradePlan` and `downgradeScheduledAt` should clear in `GET /api/test/billing/subscription`

## 6) Path Scenario D — Cancel then reactivate (within current period)

### Step D1 — Schedule cancellation

Swagger:

- `POST /api/test/billing/cancel`

Body:

```json
{
  "reason": "Testing cancel flow"
}
```

Verify:

- `GET /api/test/billing/subscription`
- `GET /api/test/billing/entity`

Look for:

- `cancellationRequestedAt`
- `cancellationEffectiveAt`

### Step D2 — Reactivate cancellation

Swagger:

- `POST /api/test/billing/reactivate`

Verify:

- `GET /api/test/billing/subscription`
- `GET /api/test/billing/entity`

Expected:

- cancellation fields cleared

## 7) Path Scenario E — Usage + plan limits (service-side)

### Step E1 — Seed a manual plan (optional dev unblock)

If your plan limits are `null` because Stripe metadata sync is not configured, you can seed a tenant manual plan.

Swagger:

- `POST /api/test/plans/seed-manual`

Body example:

```json
{
  "name": "Manual Dev Plan",
  "limits": {
    "campaigns": 5,
    "referred_users": 100,
    "seats": 3,
    "leaderboard_entries": 1000,
    "email_sends": 500
  }
}
```

### Step E2 — Increment usage

Swagger:

- `POST /api/test/usage/increment`

Body:

```json
{
  "metric": "campaigns",
  "amount": 1
}
```

Repeat a few times.

### Step E3 — View usage summary

Swagger:

- `GET /api/test/billing/usage`

Optional verification:

- `GET /api/test/billing/events?limit=20`

This returns a 7-day history per metric.

### Step E4 — View remaining capacity

Swagger:

- `GET /api/test/remaining-capacity/campaigns`

### Step E5 — Exercise BillingGuard

Swagger:

- `POST /api/test/limited-campaign`

If within limits, it should succeed.

## 8) Notes / Common gotchas

- **Wrong webhook URL**: the correct forward URL is `http://localhost:5001/webhooks/stripe`.
- **Missing `STRIPE_WEBHOOK_SECRET`**: signature verification will fail.
- **Success/Cancel URLs**: must be set (`STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`) or checkout session creation will fail.
- **Price IDs must be recurring**: one-time prices won’t work with subscription checkout.
- **Tenant header is required** for `/api/test/*` endpoints.

## 9) Payment enforcement state machine (tenant.paymentStatus)

The service uses a payment enforcement state machine on `TenantEntity.paymentStatus`:

- `active`
- `past_due`
- `restricted`
- `locked`

### State transitions

- Stripe webhook:
  - `invoice.payment_failed` => `past_due` + `paymentStatusChangedAt` set
  - `invoice.paid` / `invoice.payment_succeeded` => `active` + `paymentStatusChangedAt` set
- Scheduled escalation (BullMQ repeatable job):
  - `past_due` -> `restricted` after 7 days
  - `restricted` -> `locked` after 21 days total

### Enforcement behavior

- `PaymentRequiredGuard` denies access (HTTP 402) only when `paymentStatus=locked`.

## 10) Trigger payment failure/restoration (real Stripe webhook endpoint)

Use Stripe CLI to forward real webhook calls into the service:

```powershell
stripe listen --forward-to http://localhost:5001/webhooks/stripe
```

After you have a real subscription (Scenario A), fetch identifiers:

- `GET /api/test/billing/entity` (copy `stripeSubscriptionId`, `stripeCustomerId`)

Use those values to trigger Stripe events that match your subscription/customer:

```powershell
stripe trigger invoice.payment_failed --add invoice:subscription=<sub_id> --add invoice:customer=<cus_id>
```

```powershell
stripe trigger invoice.paid --add invoice:subscription=<sub_id> --add invoice:customer=<cus_id>
```

Verify the tenant payment enforcement state:

- `GET /api/test/tenant/payment-status`
- `GET /api/test/billing/events?limit=20`

## 11) Verify escalation job behavior

Payment status escalation runs as a BullMQ repeatable job:

- Queue: `billing-usage`
- Job: `payment-status-escalation`
- Schedule: daily at 9 AM

For demo/testing without waiting for the schedule:

- `POST /api/test/jobs/run-payment-status-escalation`

To test quickly in dev, set a tenant's `paymentStatusChangedAt` in the database to an older timestamp:

- Set `paymentStatus=past_due` and `paymentStatusChangedAt` to > 7 days ago, then run `POST /api/test/jobs/run-payment-status-escalation`.
- Set `paymentStatus=restricted` and `paymentStatusChangedAt` to > 14 days ago, then run `POST /api/test/jobs/run-payment-status-escalation`.

Expected:

- `past_due` -> `restricted`
- `restricted` -> `locked`

## 12) Endpoints added for these scenarios

All under `TestBillingController`:

- `POST /api/test/stripe/checkout-session`
- `GET /api/test/billing/subscription`
- `GET /api/test/billing/entity`
- `GET /api/test/billing/events?limit=20`
- `GET /api/test/billing/usage`
- `POST /api/test/billing/upgrade`
- `POST /api/test/billing/downgrade`
- `POST /api/test/billing/cancel`
- `POST /api/test/billing/reactivate`
- `GET /api/test/tenant/payment-status`
- `POST /api/test/usage/increment`
- `POST /api/test/usage/decrement`

Additional job triggers:

- `POST /api/test/jobs/run-payment-status-escalation`
- `POST /api/test/jobs/run-trial-lifecycle`
