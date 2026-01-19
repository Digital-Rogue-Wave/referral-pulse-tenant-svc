# Billing Module Demo Plan (Tenant Service)

This doc is a reusable **talk track + navigation plan** for demoing the billing implementation to a senior developer.

It assumes you’re running:
- Stripe **Test Mode** (Dashboard sandbox)
- Stripe CLI for webhook forwarding
- Swagger for exercising endpoints

Companion doc (step-by-step requests already validated): `billing_scenarios.md`

---

## 0) 20-second opener (say this first)

"Billing is implemented as a clean domain inside tenant-svc so it can be extracted later. It covers subscription lifecycle with Stripe (checkout/webhooks/upgrade/downgrade/cancel), usage tracking (Redis + daily snapshots), and limit enforcement (guards + plan limit resolution). I’ll show the module wiring, the core services, the enforcement points, and finally run a short end-to-end scenario using Stripe test mode + Stripe CLI webhooks."

---

## 1) Demo objectives (what the senior should leave with)

- Understand the **module boundary**: billing logic stays in `BillingModule`.
- See the **core flows**:
  - checkout → webhook updates local state
  - usage increments → usage summary with limits
  - limit enforcement returns a clean 402 error payload
- Know what is **done vs pending** per architecture:
  - implemented: subscription lifecycle, usage tracking, enforcement
  - pending: real leaderboard limiting in real leaderboard read path

---

## 2) Environment + tools (pre-demo checklist)

### Service
- API base (local): `http://localhost:5001/api`
- Swagger: `http://localhost:5001/tenant-docs`

### Required headers
- `Authorization: Bearer <jwt>`
- `tenant-id: <tenant_uuid>`

### Stripe CLI (webhook forwarding)
The service expects:
- `POST http://localhost:5001/webhooks/stripe`

Run:
```powershell
stripe listen --forward-to http://localhost:5001/webhooks/stripe
```
Copy the signing secret into:
- `STRIPE_WEBHOOK_SECRET=whsec_...`

(Full checklist is in `billing_scenarios.md`.)

---

## 3) What files to open (minimal set, in the right order)

### A) Module boundary / wiring
1) `src/billing/billing.module.ts`
- What to say:
  - "This is the billing boundary: controllers + providers are registered here."
  - "Anything billing-related should live here to keep extraction feasible."

### B) Persisted state (data model)
2) `src/billing/billing.entity.ts`
- What to say:
  - "Stores subscription and billing state: plan, subscription status, Stripe IDs, pending downgrade/cancel metadata."

3) `src/billing/plan.entity.ts` and `src/billing/plan-limits.type.ts`
- What to say:
  - "Plans are stored locally; `limits` is the source-of-truth for enforcement metrics (campaigns, seats, email_sends, etc.)."

4) `src/billing/tenant-usage.entity.ts` and `src/billing/billing-event.entity.ts`
- What to say:
  - "We store daily usage snapshots and billing events for analytics/debug and future ClickHouse sync."

5) `src/tenant/tenant.entity.ts` and `src/common/enums/billing.enum.ts`
- What to say:
  - "Tenant has `status` (active/suspended/locked) and `paymentStatus` (active/past_due/restricted/locked)."
  - "Payment status transitions come from Stripe webhooks and deterministic escalation."

### C) Core business services (the engine)
6) `src/billing/billing.service.ts`
- What to say:
  - "Orchestrates subscription endpoints and Stripe webhook reconciliation."
  - "Also returns usage summary to the tenant-facing billing API."

7) `src/billing/plan-limit.service.ts`
- What to say:
  - "Resolves plan limits for a tenant and enforces them."
  - "Important behavior: default handling when BillingEntity is missing (FREE plan enforcement depending on configuration)."

8) `src/billing/usage-tracker.service.ts`
- What to say:
  - "Handles usage snapshots and delegates realtime counting to Redis."

9) `src/billing/redis-usage.service.ts`
- What to say:
  - "Atomic realtime counters; this is what makes enforcement reliable across services."

### D) Enforcement (enterprise quality)
10) `src/billing/guards/*` (especially `payment-required.guard.ts`, billing/usage guards)
- What to say:
  - "Guards enforce billing access and plan limits at boundaries." 

11) `src/billing/exceptions/limit-exceeded.exception.ts`
- What to say:
  - "When a limit is exceeded, we return HTTP 402 with structured details (metric, current usage, limit, requested, remaining)."

### E) Internal integration (cross-service boundary)
12) `src/billing/usage-internal.controller.ts`
- What to say:
  - "Other services can call this internal API to increment/decrement usage; enforcement is centralized here."

### F) Demo-only endpoints (show last and label clearly)
13) `src/billing/test-billing.controller.ts`
- What to say:
  - "This controller exists to demo/verify the real Stripe integration quickly via Swagger."
  - "It exposes real actions (checkout/upgrade/downgrade/cancel) plus read-only inspection endpoints so we can prove what webhooks changed in DB."

---

## 4) The mental model (simple explanation you can repeat)

- Plan limits live in: `PlanEntity.limits`
- Subscription state lives in: `BillingEntity`
- Realtime usage lives in: Redis counters
- Snapshots live in: `TenantUsageEntity`
- Enforcement happens in:
  - guards for tenant-facing APIs
  - internal usage mutation endpoints for cross-service operations
- Stripe is reconciled via:
  - checkout session creation
  - webhook processing (`/webhooks/stripe`)

---

## 5) Live demo script (5–10 minutes)

### Step 1 — Prove wiring and scope (30–60 seconds)
Open `billing.module.ts`.
- Say: "Billing is packaged in its own module; easy to extract later."

### Step 2 — Prove core business logic exists (2 minutes)
Open `billing.service.ts` and `plan-limit.service.ts`.
- Say: "This is the orchestration layer and the enforcement/lifecycle core."

### Step 3 — Prove Stripe end-to-end works (2–4 minutes)
Use the validated sequence from `billing_scenarios.md`:
- `POST /api/test/stripe/checkout-session` (pick `starter`)
- Complete Stripe checkout in browser using `4242 4242 4242 4242`
- Stripe CLI forwards webhooks to `/webhooks/stripe`
- Verify:
  - `GET /api/test/billing/subscription`
  - `GET /api/test/billing/entity`
  - `GET /api/test/tenant/payment-status`
  - `GET /api/test/billing/events?limit=20`
  - Stripe Dashboard shows Customer + Subscription + Events

What to say:
- "Checkout does not directly mutate billing state; webhook is the source-of-truth."
- "We rely on signature verification and metadata to connect Stripe events to tenant + plan."
- "These inspection endpoints are showing real persisted IDs and timestamps produced by webhooks."

Optional (60 seconds): prove payment failure / restoration via Stripe CLI triggers

- Get IDs from `GET /api/test/billing/entity`
- Trigger:
  - `stripe trigger invoice.payment_failed --add invoice:subscription=<sub_id> --add invoice:customer=<cus_id>`
  - `stripe trigger invoice.paid --add invoice:subscription=<sub_id> --add invoice:customer=<cus_id>`
- Verify:
  - `GET /api/test/tenant/payment-status`

### Step 4 — Prove usage tracking + limits (2–3 minutes)
If Stripe plan limits are not present (metadata not synced), use the manual plan seed:
- `POST /api/test/plans/seed-manual`

Then:
- `POST /api/test/usage/increment` for `campaigns`
- `GET /api/test/billing/usage`
- `GET /api/test/remaining-capacity/campaigns`

What to say:
- "Realtime usage is stored in Redis; summaries include limits and percentage used."

### Step 5 — Prove enforcement behavior (1–2 minutes)
- Push usage beyond the configured plan limit.
- Call a guarded endpoint such as `POST /api/test/limited-campaign`.

What to say:
- "Limit enforcement returns HTTP 402 with a structured payload so frontend can show clear upgrade guidance."

---

## 6) Known gaps / honest next steps (say this confidently)

### A) `/internal/tenants/:id/status`
- Status: implemented
- Purpose: other services can fetch a cached allow/deny decision and current enforcement status.

### B) Full `payment_status` state machine alignment
- Status: implemented (enum + migration + deterministic escalation + webhook mapping)
- Next step: downstream Temporal workflows consuming `tenant.payment_status.changed`

### C) Leaderboard limiting
- Status: backlog item (Phase 6.5)
- Current state: only a demo exists; real leaderboard read path must implement the query limit.

### D) Side effects (enterprise pattern)
- Campaign pausing + billing emails/notifications should be handled by Temporal workflows triggered by events.
- This module’s responsibility: publish events + enforce policy at API boundaries.

---

## 7) “If asked” answers (quick responses)

- "Why `/v1/billings/*` and not `/tenants/:id/*`?"
  - "To keep a clean billing domain boundary and allow future extraction; tenant context comes from auth/tenant-id."

- "Where does enforcement happen?"
  - "In guards on write endpoints and on internal usage increment endpoints."

- "How do you ensure Stripe is consistent?"
  - "Webhook signature verification + metadata, webhook as source-of-truth, and local persistence in BillingEntity."

---

## 8) Personal checklist (10 minutes before demo)

- Service running locally.
- Stripe CLI forwarding active.
- `STRIPE_WEBHOOK_SECRET` set to current `whsec_...`.
- Swagger open in browser.
- A known `tenant-id` ready.
- `billing_scenarios.md` ready for copy/paste of request bodies.
