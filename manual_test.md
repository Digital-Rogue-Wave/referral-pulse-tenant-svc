# Manual Billing Test Guide (Swagger)

This guide is a step-by-step checklist to manually test the billing module using Swagger.

Swagger URL (default): `http://localhost:<PORT>/tenant-docs`

API prefix + versioning:
- Most production endpoints are under: `/api/v1/...`
- Webhooks are under: `/api/v1/webhook/...`
- Testing endpoints in this repo are currently mounted without versioning: `/api/test/...`

---

## 0) Prerequisites

### 0.1 Required environment variables

Ensure these are configured in your `.env` (or environment) before running the service:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SUCCESS_URL`
- `STRIPE_CANCEL_URL`
- `STRIPE_FREE_PRICE_ID`
- `STRIPE_STARTER_PRICE_ID`
- `STRIPE_GROWTH_PRICE_ID`
- `STRIPE_ENTERPRISE_PRICE_ID`

Optional (trial):
- `TRIAL_DURATION_DAYS` (default `14`)

### 0.2 Start the service

Run the service normally. Confirm health:

- `GET /api/test/health`

---

## 1) Swagger Authentication + Tenant Context

This service uses global guards:
- `JwtAuthGuard` (global)
- `KetoGuard` (global)

Important:
- `/test/*` endpoints are also protected by the global `JwtAuthGuard`.
- If Swagger does **not** show a lock icon for an endpoint, it typically means Swagger will **not** attach your Bearer token.
- `TestBillingController` is annotated with `@ApiBearerAuth()` so Swagger should now show the lock icon and include the token.

So most endpoints require:

### 1.1 Swagger Bearer token

In Swagger, click **Authorize** and set:

- `Authorization: Bearer <JWT>`

### 1.2 Tenant context

Most tenant-aware billing endpoints require tenant context via header:

- `tenant-id: <TENANT_ID>`

Notes:
- Some endpoints read tenant from CLS; in Swagger you generally need the `tenant-id` header.

---

## 2) Plan Sync + Verify Plans

### 2.1 Sync plans from Stripe (admin/testing)

- `POST /api/test/sync-stripe`

Expected:
- `Stripe plans synced!`

### 2.2 Verify public plans in DB/cache

- `GET /api/test/check-plans`

Expected:
- A non-empty list (depending on your Stripe config + sync logic)

---

## 3) Subscription / Checkout (Tenant billing endpoints)

All endpoints below require:
- Bearer token
- `tenant-id` header
- Keto permission `MANAGE_BILLING`

### 3.1 Get current subscription state

- `GET /api/v1/billings/subscription`

Expected fields to check:
- `plan`
- `subscriptionStatus`
- `paymentStatus`
- `stripeCustomerId`
- `stripeSubscriptionId`
- `stripeTransactionId`
- `trialActive`, `trialEndsAt`, `trialDaysRemaining`

### 3.2 Create checkout session

- `POST /api/v1/billings/subscription/checkout`

Body example:
```json
{
  "plan": "starter"
}
```

Expected:
- Response contains `checkoutUrl` and `sessionId`

Complete checkout in the returned `checkoutUrl`.

---

## 4) Stripe Webhooks (MOST IMPORTANT)

### 4.1 Real Stripe webhook endpoint

Stripe posts to:
- `POST /webhooks/stripe`

This endpoint:
- Validates `stripe-signature` using `STRIPE_WEBHOOK_SECRET`
- Routes events in `BillingService.handleStripeWebhook()`

Implemented Stripe event types handled:
- `checkout.session.completed`
- `invoice.payment_succeeded` (also accepts `invoice.paid`)
- `invoice.payment_failed`
- `customer.subscription.deleted`

### 4.2 Manual webhook testing (real Stripe webhook endpoint via Stripe CLI)

Use Stripe CLI to forward real signed webhooks into the service:

```powershell
stripe listen --forward-to http://localhost:5001/webhooks/stripe
```

#### 4.2.1 Create a real subscription (Checkout)

Use Swagger:

- `POST /api/test/stripe/checkout-session`

Complete checkout in the browser.

Verify:

- `GET /api/test/billing/subscription`
- Stripe Dashboard (Test mode) shows Customer + Subscription + Events

#### 4.2.2 Trigger payment succeeded / paid

Fetch identifiers:

- `GET /api/test/billing/subscription` (copy `stripeSubscriptionId` and `stripeCustomerId`)

Trigger:

```powershell
stripe trigger invoice.paid --add invoice:subscription=<sub_id> --add invoice:customer=<cus_id>
```

Verify:

- `GET /api/test/tenant/payment-status` => `paymentStatus=active`

#### 4.2.3 Trigger payment failed

```powershell
stripe trigger invoice.payment_failed --add invoice:subscription=<sub_id> --add invoice:customer=<cus_id>
```

Verify:

- `GET /api/test/tenant/payment-status` => `paymentStatus=past_due`

---

## 5) Payment-required behavior (Guard)

When payment fails, `tenant.paymentStatus` can become `past_due`.

### 5.1 Validate PaymentRequiredGuard behavior

Use a dedicated testing endpoint protected by `PaymentRequiredGuard`:

- `GET /api/test/protected/payment-required`

Requirements:
- Provide `tenant-id` header
- Provide Bearer token

When `tenant.paymentStatus = locked`, you should get:

- HTTP `402 Payment Required`

---

## 6) Usage Tracking + Limits

### 6.1 Increment usage via internal API

This internal endpoint sets CLS tenant context from the route param:

- `POST /api/v1/internal/tenants/:tenantId/usage/increment`

Body example:
```json
{
  "metric": "campaigns",
  "amount": 1
}
```

### 6.2 Validate BillingGuard / plan limit enforcement (test endpoint)

- `POST /api/test/limited-campaign`

Requirements:
- Provide `tenant-id` header
- Provide Bearer token

Expected:
- If within limit, `200 OK`
- If exceeded, `402 Payment Required` with limit details

### 6.3 Check remaining capacity

- `GET /api/test/remaining-capacity/:metric`

Example:
- `/api/test/remaining-capacity/campaigns`

### 6.4 Leaderboard limiting demo

- `GET /api/test/leaderboard-demo?total=50`

Expected:
- Response includes `shown` and a `note` reflecting the plan limit `leaderboard_entries`.

---

## 7) Daily Snapshot + Monthly Reset (Manual triggers)

### 7.1 Run daily snapshot

- `POST /api/test/usage/run-daily-snapshot`

Expected:
- Creates/updates `TenantUsageEntity` rows for current date for metrics present in Redis.

### 7.2 Run monthly reset

- `POST /api/test/usage/run-monthly-reset`

Expected:
- Writes `usage.monthly_summary` `BillingEventEntity` records
- Clears previous month Redis counters and threshold flags

---

## 8) Troubleshooting

### 8.1 Getting `401 Unauthorized` in Swagger

Common causes:
- Missing Bearer token in Swagger Authorize
- Global guards (`JwtAuthGuard`) block even `/test/*` endpoints

Fix:
- Always set Swagger **Authorize** Bearer token.

### 8.2 Getting `403 Forbidden` in Swagger

Cause:
- `KetoGuard` requires permissions like `MANAGE_BILLING` for `/billings/*`

Fix:
- Use a token that has the proper Keto relation/permission for the tenant.

### 8.3 Stripe webhook errors

Cause:
- `STRIPE_WEBHOOK_SECRET` not set, signature cannot be verified.

Fix:
- Configure `STRIPE_WEBHOOK_SECRET`
- Ensure Stripe CLI forwarding is running (`stripe listen --forward-to ...`).
