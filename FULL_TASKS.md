## Legend

- **[status: done]** – Matches spec / OpenSpec now, only optional polish or tests.
- **[status: refactor]** – Feature exists but must be adjusted to match spec.
- **[status: new]** – Not present; must be implemented.

---

## Phase 1 – Database & Core Entities

### 1.1 Plan entity & 1.2 limits schema

- **1.1.1 [new] Implement `PlanEntity`**
  - Create TypeORM entity with:
    - `name`, `stripe_price_id`, `stripe_product_id`, `interval`.
    - `limits` JSONB.
    - `tenant_id` (nullable for public vs enterprise).
    - `is_active` boolean, `metadata` JSONB.
  - Register with TypeORM + `TenantAwareRepositoryModule`.
  - Migration to create `plans` table with indexes.

- **1.2.1 [new] Plan limits type + validation**
  - Define `PlanLimits` TS type/interface (`referred_users`, `campaigns`, `seats`, `leaderboard_entries`, `email_sends`).
  - Add validators/sanitizers for limits.
  - Ensure `PlanEntity.limits` uses this type.
  - Migration to add `limits` column if not done in 1.1.

### 1.3 Tenant trial fields

- **1.3.1 [new] Extend `TenantEntity` with trial columns**
  - Add `trial_started_at`, `trial_ends_at` (nullable timestamps).
  - Migration to add columns + optional backfill/defaults.

### 1.4 Tenant status & payment status

- **1.4.1 [refactor/new] Align tenant status model with spec**
  - Update `TenantStatusEnum` to include `ACTIVE`, `SUSPENDED`, `LOCKED` per spec.
  - Decide what to do with current `PENDING` / `DELETION_SCHEDULED` (keep as extra or map into new model).
  - Migration to adjust existing data.

- **1.4.2 [new] Add payment state fields on tenant**
  - Add `payment_status` field to `TenantEntity` (enum, can reuse `PaymentStatusEnum`).
  - Add `suspended_at`, `locked_at` timestamps.
  - Migration to add fields and initialize sane defaults.

### 1.5 TenantUsage entity

- **1.5.1 [new] Implement `TenantUsageEntity`**
  - Fields: `tenant_id`, `metric_name`, `period_date`, `current_usage`, `limit_value`.
  - Composite unique index `(tenant_id, metric_name, period_date)`.
  - Migration to create table.

### 1.6 BillingEvent entity

- **1.6.1 [new] Implement `BillingEventEntity`**
  - Fields: `tenant_id`, `event_type`, `metric_name`, `increment`, `timestamp`, `metadata`.
  - Index on `(tenant_id, timestamp)`.
  - Migration to create table.

---

## Phase 2 – Plan Management

### 2.1 Admin Plan CRUD

- **2.1.1 [new] Plan CRUD API (admin)**
  - `PlanController` + `PlanService`:
    - `POST /admin/plans`
    - `GET /admin/plans`
    - `GET /admin/plans/:id`
    - `PUT /admin/plans/:id`
    - `DELETE /admin/plans/:id` (soft delete via `is_active`).
  - Apply admin-only authorization guards.

### 2.2 Enterprise plan CRUD

- **2.2.1 [new] Enterprise-specific plans**
  - Extend Plan CRUD to support `tenant_id`-scoped plans (enterprise).
  - Add `manual_invoicing` flag on `PlanEntity`.
  - Ensure enterprise plans only visible/usable to their tenant.

### 2.3 Visibility filtering

- **2.3.1 [new] Visibility-aware plan repository**
  - Implement methods:
    - Public plans: `tenant_id IS NULL`.
    - Enterprise plans: `tenant_id = :tenantId`.
  - Use tenant context (CLS/header) consistently.

### 2.4 Stripe sync

- **2.4.1 [new] Stripe Products/Prices sync job**
  - Scheduled job/service to:
    - Pull Stripe Products and Prices.
    - Upsert `PlanEntity` with `stripe_product_id` / `stripe_price_id`.
    - Map Stripe metadata into `limits` and `metadata`.
    - Mark deleted products appropriately.
  - Add logging + metrics.

### 2.5 Plan caching

- **2.5.1 [new] Redis plan cache**
  - Cache plan lists (public and per-tenant) via `RedisService`.
  - TTL ~1h.
  - Invalidate on CRUD changes.
  - Fallback to DB on miss.

### 2.6 Public GET /plans

- **2.6.1 [new] Implement `GET /plans` (public)**
  - Return public plans only.
  - Include comparison info and annual savings.
  - Add basic recommendation logic, tied to usage once Phase 5 is in place.

---

## Phase 3 – Subscription Management

### Alignment with `add-subscription-checkout` OpenSpec

Current code for:

- `POST /billings/subscription/checkout`
- [BillingService.subscriptionCheckout](cci:1://file:///d:/Projects/Work/REFERRAL/referral-pulse-tenant-svc/src/billing/billing.service.ts:93:4-111:5)
- `WebhookController.POST /webhooks/stripe`
- [BillingService.handleStripeWebhook](cci:1://file:///d:/Projects/Work/REFERRAL/referral-pulse-tenant-svc/src/billing/billing.service.ts:131:4-190:5) → [handleCheckoutSessionCompleted](cci:1://file:///d:/Projects/Work/REFERRAL/referral-pulse-tenant-svc/src/billing/billing.service.ts:192:4-265:5)
- `BillingListener` → SNS + metrics  
already **matches** the `add-subscription-checkout` spec:

- Constructs Checkout Session with `tenantId` & `planId` metadata.
- Handles `Free` vs paid plans correctly.
- Only updates `BillingEntity` in webhook handler.
- Logs `SUBSCRIPTION_UPDATED` and emits `subscription.changed`.

So for the OpenSpec change, the main work is **tests and small cleanups**, not big refactors.

#### 3.x – Common cleanup

- **3.0.1 [refactor] Fix [SubscriptionChangedEvent](cci:2://file:///d:/Projects/Work/REFERRAL/referral-pulse-tenant-svc/src/common/interfaces/billing-events.interface.ts:2:0-8:1) interface imports**
  - [common/interfaces/billing-events.interface.ts](cci:7://file:///d:/Projects/Work/REFERRAL/referral-pulse-tenant-svc/src/common/interfaces/billing-events.interface.ts:0:0-0:0) currently imports enums from [tenant.enum.ts](cci:7://file:///d:/Projects/Work/REFERRAL/referral-pulse-tenant-svc/src/common/enums/tenant.enum.ts:0:0-0:0); should import from [billing.enum.ts](cci:7://file:///d:/Projects/Work/REFERRAL/referral-pulse-tenant-svc/src/common/enums/billing.enum.ts:0:0-0:0).
  - Ensure type correctness & build passes.

- **3.0.2 [refactor] Ensure tenant context from `tenant-id` header**
  - Confirm the `tenant-id` header is used to set tenant context (CLS → `TenantAwareRepository`).
  - If missing/incomplete, add interceptor/guard to enforce header and populate CLS.

- **3.0.3 [tests] Tests for `add-subscription-checkout` scenarios**
  - Unit/integration tests covering:
    - Paid plans checkout.
    - Free plan checkout.
    - Webhook success path (billing updated, audit logged, SNS event emitted).
    - Webhook invalid signature (no state change, non-2xx).

### 3.1 GET subscription

- **3.1.1 [new] Implement spec-aligned subscription read**
  - Use `/billings/subscription` as the single source of truth (no duplicate tenant controller route).
  - Combine:
    - `BillingEntity`.
    - Stripe subscription details.
    - Trial info (Phase 7).
    - Usage summary (Phase 5/6).
  - Return extended [SubscriptionStatusDto](cci:2://file:///d:/Projects/Work/REFERRAL/referral-pulse-tenant-svc/src/billing/dto/subscription-status.dto.ts:3:0-39:1).

### 3.2 Checkout session creation

- **3.2.1 [refactor] Ensure endpoint & metadata fully match spec**
  - Confirm:
    - Endpoint path and version (`/v1/billings/subscription/checkout`).
    - Accepts `tenant-id` header + plan.
    - Stripe metadata includes `tenantId`, `planId`, plus `userId` if required by spec/BILLING.md (coupon handling later).
  - Add coupon validation hook as per BILLING.md.

### 3.3 Webhook handling

- **3.3.1 [refactor] Tighten webhook correctness & observability**
  - Verify:
    - Signature verification failures never mutate state; respond non-2xx.
    - Success path logs appropriate metrics and audit (already mostly done).
  - Add more detailed logs/metrics if needed per BILLING.md.

### 3.4 Upgrade flow

- **3.4.1 [new] Upgrade endpoints**
  - `POST /billings/subscription/upgrade`.
  - Upgrade preview endpoint with proration.

- **3.4.2 [new] Stripe subscription upgrade logic**
  - Integrate with Stripe to:
    - Change plan with proration.
    - Immediately update `BillingEntity` (plan + status).
  - Emit `subscription.upgraded` event and send upgrade email.

### 3.5 Downgrade flow

- **3.5.1 [new] Downgrade scheduling**
  - `POST /billings/subscription/downgrade`.
  - Validate usage vs new plan limits (depends on Phase 5/6).
  - Schedule change at period end in Stripe.
  - Persist pending downgrade state.

- **3.5.2 [new] Downgrade support endpoints & notifications**
  - Cancel-pending-downgrade endpoint.
  - Downgrade scheduled email.
  - `subscription.downgrade_scheduled` event.

### 3.6 Cancellation

- **3.6.1 [new] Cancel/reactivate endpoints**
  - `POST /billings/subscription/cancel`.
  - `POST /billings/subscription/reactivate`.

- **3.6.2 [new] Stripe cancel/reactivate integration**
  - Use Stripe to:
    - Cancel at period end.
    - Reactivate subscriptions.
  - Store cancellation reason.
  - Handle expiry via Stripe webhooks (`invoice.payment_failed`/`customer.subscription.deleted` etc).
  - Emit `subscription.cancelled` event.

### 3.7 Early upgrade during trial

- **3.7.1 [new] Early upgrade logic**
  - If tenant is on trial:
    - Allow upgrade before trial end.
    - Pro-rate charges correctly.
    - End trial and update trial flags + `BillingEntity` status.

---

## Phase 4 – Payment & Invoice Management

### 4.1 Payment methods

- **4.1.1 [new] SetupIntent + payment-method API**
  - Endpoints:
    - `POST /billings/payment-methods`.
    - `GET /billings/payment-methods`.
    - `DELETE /billings/payment-methods/:id`.
  - Use Stripe:
    - Create SetupIntent.
    - List/set default/detach payment methods.

### 4.2 Invoices

- **4.2.1 [new] Invoice listing & upcoming preview**
  - `GET /billings/invoices` to list Stripe invoices.
  - Add invoice PDF download support.
  - Implement “upcoming invoice” preview via Stripe API.

### 4.3 Payment failure & guard

- **4.3.1 [new] Grace period and payment state updates**
  - Extend [handleInvoicePaymentFailed](cci:1://file:///d:/Projects/Work/REFERRAL/referral-pulse-tenant-svc/src/billing/billing.service.ts:267:4-284:5) / `invoice.payment_succeeded` to:
    - Update `TenantEntity.payment_status`.
    - Track grace period timing.

- **4.3.2 [new] PaymentRequired guard**
  - Guard for protected endpoints:
    - Block when payment overdue (respect grace).
    - Restore access when invoice paid.

---

## Phase 5 – Usage Tracking System

- **5.1.1 [new] `UsageTrackerService`**
  - Central service for:
    - Increment/decrement usage.
    - Persist daily/monthly rollups into `TenantUsageEntity`.

- **5.2.1 [new] Usage check middleware/guard**
  - Intercept relevant create actions.
  - Consult `PlanLimitService` (Phase 6.6) / `RedisUsageService`.
  - Throw custom `LimitExceededException` (Phase 5.5).

- **5.3.1 [new] Wire usage increments/decrements**
  - In campaign, team-member, referral, etc. services:
    - Increment on create.
    - Decrement on delete.

- **5.4.1 [new] Monthly usage reset job**
  - Scheduled/Bull job:
    - Archive current month to `TenantUsageEntity`.
    - Reset counters.
    - Send usage summary emails.

- **5.5.1 [new] `LimitExceededException`**
  - HTTP 402 with:
    - Metric, current usage, limit, upgrade suggestions, billing portal link.

- **5.6.1 [new] `GET /billings/usage` endpoint**
  - Returns:
    - Current usage, limits, % used, basic history.

- **5.7.1 [new] `RedisUsageService`**
  - Implement Redis counters & TTL per spec key structure.

- **5.8.1 [new] Referral SQS consumer**
  - `ReferralEventProcessor`:
    - Consume referral events from SQS.
    - Validate and call `RedisUsageService.trackUsage()`.
    - Emit analytics events (Phase 9).

- **5.9.1 [new] Daily usage cron**
  - Nightly job:
    - Read Redis counters.
    - Write snapshots to `TenantUsageEntity`.
    - Check thresholds (80/100%) and emit notifications.
    - Clean/reset Redis keys.

---

## Phase 6 – Limit Enforcement

- **6.1.1 [new] Usage vs plan validation service**
  - Compare current usage vs plan limits for one or multiple metrics.
  - Respect special trial allowances.

- **6.2.1 [new] Wire `LimitExceededException` across code**
  - Ensure all protected flows throw the same exception, with consistent payload.

- **6.3.1 [new] `BillingGuard`**
  - `CanActivate` guard:
    - Validate subscription status.
    - Validate usage against limits.
    - Respect trial (no 402 during valid trial).

- **6.4.1 [new] Hard cut-off**
  - Apply `BillingGuard` to all resource-creation endpoints.
  - Support configurable grace percentage (e.g. allow up to 110% of limit).

- **6.5.1 [new] Leaderboard limiting**
  - Modify leaderboard queries to:
    - Limit results to `leaderboard_entries`.
    - Add “Showing top X of Y (plan limit)” note.

- **6.6.1 [new] `PlanLimitService` utility**
  - Implement:
    - `getPlanLimits(tenantId)`.
    - `canPerformAction(tenantId, action, count?)`.
    - `getRemainingCapacity(tenantId, metric)`.
    - `enforceLimit(tenantId, metric, value)`.

---

## Phase 7 – Trial Management

- **7.1.1 [new] Trial initialization on tenant creation**
  - On `tenant.created`:
    - Set `trial_started_at`, `trial_ends_at` (14 days).
    - Apply trial limits (starter-equivalent).

- **7.2.1 [new] Trial expiry guard**
  - Middleware/guard:
    - Block tenant actions after trial expiry with no active subscription.
    - Redirect/point to upgrade flow.

- **7.3.1 [new] Trial reminder jobs**
  - Scheduler:
    - Reminder 3 days before end.
    - Final reminder 1 day before.
    - “Trial expired” notification.

- **7.4.1 [new] Trial expiry downgrade**
  - Automatically:
    - Downgrade tenant to free plan.
    - Adjust limits.
    - Update subscription status and send email.

- **7.5.1 [new] Early upgrade integration**
  - Ensure early upgrade (Phase 3.7) correctly:
    - Ends trial.
    - Updates trial flags and subscription/usage state.

---

## Phase 8 – Tenant Status Management

- **8.1.1 [new] Admin suspend endpoint**
  - `POST /admin/tenants/:id/suspend`:
    - Set `status = SUSPENDED`, `suspended_at`.
    - Publish `tenant.suspended` event.

- **8.2.1 [new] Campaign pause behaviors**
  - In this repo: publish events only.
  - In downstream services: handle `tenant.suspended` to:
    - Pause campaigns, stop emails and tracking.

- **8.3.1 [new] Suspension notification**
  - Email tenant admins with reason/duration/support info.

- **8.4.1 [new] Admin unsuspend endpoint**
  - `POST /admin/tenants/:id/unsuspend`:
    - Set `status = ACTIVE`, clear `suspended_at`.
    - Resume campaigns (via events).
    - Send restoration confirmation.

- **8.5.1 [new] Lock endpoint**
  - `POST /tenants/:id/lock`:
    - Require admin auth + Ory confirmation.
    - Set `status = LOCKED`, `locked_at`.

- **8.6.1 [new] Unlock endpoint**
  - `POST /tenants/:id/unlock`:
    - Verify admin credentials via Ory.
    - Restore `ACTIVE`.
    - Send unlock email.

- **8.7.1 [new] Auto-unlock job**
  - Bull job:
    - Auto-unlock after configurable period.
    - Email + audit logs.

- **8.8.1 [new] Tenant status guard**
  - Guard on all tenant-scoped routes:
    - Block suspended/locked tenants.
    - Return correct HTTP codes and include status in headers.

---

## Phase 9 – Analytics & Monitoring

- **9.1.1 [new] ClickHouse schema**
  - Define DDL for:
    - `billing_events`.
    - `tenant_usage_daily`.
    - `subscription_changes`.
  - This may live in infra repo, but service must be aware of schema.

- **9.2.1 [new] `ClickHouseService`**
  - Pooled connections.
  - Batch inserts.
  - Common query methods.
  - Retry + health checks.

- **9.3.1 [new] Integrate event processors with ClickHouse**
  - From:
    - [BillingService](cci:2://file:///d:/Projects/Work/REFERRAL/referral-pulse-tenant-svc/src/billing/billing.service.ts:18:0-285:1) (subscription changes, payment events).
    - `UsageTrackerService` / `RedisUsageService`.
    - SQS consumers.
  - Log all important events to ClickHouse.

- **9.4.1 [new] Billing analytics endpoints**
  - `GET /billing/analytics/usage-trends`.
  - `GET /billing/analytics/revenue`.
  - `GET /billing/analytics/conversion`.
  - `GET /billing/debug/events` (admin).

- **9.5.1 [new] Monitoring & alerts**
  - Add Prometheus metrics for billing.
  - Define alert rules (limit hits, webhook failures, Redis memory, ClickHouse errors).
  - Create Grafana dashboards.

- **9.6.1 [new] Billing reports**
  - Periodic report generator:
    - Monthly tenant usage.
    - Revenue.
    - Trial conversion.
  - Export CSV/PDF and email.