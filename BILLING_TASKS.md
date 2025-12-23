# Billing Module Tasks – Phases 1–9

Canonical feature list: `BILLING.md` (Phases 1–9)
Supporting spec: `openspec/changes/add-subscription-checkout/specs/tenant-billing/spec.md`

Status legend:
- `[x]` Implemented in this repo and matches current spec/behavior.
- `[ ]` Not implemented yet or needs refactor/extension to meet the spec.

This checklist is intended to be **kept up to date as implementation progresses**.

---

## 0. OpenSpec Change – `add-subscription-checkout`

These items come from `openspec/changes/add-subscription-checkout/specs/tenant-billing/spec.md` and **are already implemented**.

- [x] 0.1 `POST /billings/subscription/checkout` for paid plans
  - Accepts a paid plan (`Starter`, `Growth`, `Enterprise`) using `BillingPlanEnum`.
  - Uses tenant context (via `tenant-id` header / CLS + `TenantAwareRepository`).
  - Calls Stripe to create a Checkout Session with metadata containing `tenantId` and `planId`.
  - Returns the Checkout Session URL and identifier to the caller.
  - Does **not** update `BillingEntity` in the handler.

- [x] 0.2 `POST /billings/subscription/checkout` for `Free` plan
  - Supports `plan=Free` using the configured Free Stripe price.
  - Uses the same Stripe Checkout flow and metadata (`tenantId`, `planId`).
  - Does **not** update `BillingEntity` or cancel any subscription in the handler.
  - Relies on the webhook flow (below) to apply the final billing state.

- [x] 0.3 `POST /webhook/stripe` – successful `checkout.session.completed`
  - Verifies the Stripe webhook signature using the configured webhook secret.
  - Requires metadata to contain valid `tenantId` and `planId`.
  - Updates the corresponding `BillingEntity` as follows:
    - Sets `plan` to the selected plan.
    - For paid plans: sets `status = active` and stores `stripeCustomerId` and `stripeSubscriptionId`.
    - For the `Free` plan: sets `status = none`, stores `stripeCustomerId`, and clears `stripeSubscriptionId`.
    - Stores the latest Stripe transaction id (`stripeTransactionId`).
  - Logs a `SUBSCRIPTION_UPDATED` audit entry via `AuditService`.
  - Publishes a `subscription.changed` event which is forwarded to SNS by `BillingListener`.
  - Responds to Stripe with a 2xx status code when processing succeeds.

- [x] 0.4 `POST /webhook/stripe` – invalid signature handling
  - When the Stripe webhook signature cannot be validated:
    - Does **not** update any tenant/billing data.
    - Responds to Stripe with a non‑2xx status code.
    - Logs the failure for observability without leaking sensitive payload.

> NOTE: Any future refactors to this flow should update this section if behavior changes.

---

## Phase 1 – Database & Core Entities (`BILLING.md` §3)

- [x] 1.1 Create `Plan` entity with TypeORM
  - `PlanEntity` with fields: `name`, `stripe_price_id`, `stripe_product_id`, `interval`.
  - JSONB `limits` column.
  - `tenant_id` for custom enterprise plans.
  - `is_active` soft‑delete flag.
  - `metadata` JSONB for extra configuration.

- [x] 1.2 Plan limits schema (JSONB)
  - TypeScript interface for plan limits (`referred_users`, `campaigns`, `seats`, `leaderboard_entries`, `email_sends`).
  - Validation for limit values.
  - Migration to add `limits` column to `plans` table.

- [x] 1.3 Add trial fields to `Tenant`
  - `trial_ends_at` (nullable timestamp).
  - `trial_started_at` for tracking duration.
  - Migration to add and backfill defaults where needed.

- [x] 1.4 Add tenant status & payment fields
  - `status` enum on `Tenant` supporting at least: `active`, `suspended`, `locked`.
  - `payment_status` field for payment state.
  - `suspended_at` and `locked_at` timestamps.
  - Migration to update existing tenants.

- [x] 1.5 Create `TenantUsage` entity for daily snapshots
  - Fields: `tenant_id`, `metric_name`, `period_date`, `current_usage`, `limit_value`.
  - Composite unique index on `(tenant_id, metric_name, period_date)`.

- [x] 1.6 Create `BillingEvent` entity for ClickHouse sync
  - Fields: `tenant_id`, `event_type`, `metric_name`, `increment`, `timestamp`, `metadata`.
  - Index on `tenant_id` and `timestamp` for efficient querying.

---

## Phase 2 – Plan Management (`BILLING.md` §39–77)

- [x] 2.1 Admin Plan CRUD (public + enterprise)
  - `POST /billings/admin/plans`, `GET /billings/admin/plans`, `GET /billings/admin/plans/:id`, `PUT /billings/admin/plans/:id`, `DELETE /billings/admin/plans/:id`.
  - Admin‑only authorization via `JwtAuthGuard` + `KetoGuard` with `MANAGE_PLANS` and service token support.

- [x] 2.2 Enterprise‑specific plan CRUD
  - Support creating custom plans for specific tenants (`tenant_id` set via DTO + tenant context).
  - `manual_invoicing` flag for enterprise billing with validation that it must be associated with a tenant.

- [x] 2.3 Plan visibility filtering
  - Public plans: `tenant_id IS NULL`.
  - Enterprise plans: `tenant_id = :tenantId` (handled via tenant context and DTO fields in admin CRUD).
  - Public listing endpoint only returns active public plans; admin listing supports filters.

- [ ] 2.4 Stripe Products/Prices sync
  - Sync Stripe Products/Prices into `PlanEntity`.
  - Update `stripe_price_id`, `stripe_product_id`, limits and metadata.
  - Handle new/updated/deleted products.
  - **Status:** Core sync logic implemented in `PlanStripeSyncService`; scheduling and optional automation tracked separately.

- [ ] 2.4.1 (optional) BullMQ-based recurring sync job
  - Background BullMQ job to call `PlanStripeSyncService.syncFromStripe` on a schedule (e.g. hourly).
  - Config flag to enable/disable the recurring sync.
  - Logging/metrics around sync runs and failures.

- [x] 2.5 Redis plan caching
  - Cache public plan data with TTL (~1h) using `RedisService` and `RedisKeyBuilder`.
  - Invalidate cache on plan updates/creates/deletes.
  - Fallback to database on miss.

- [x] 2.6 Public `GET /plans` endpoint
  - `GET /billings/plans` returns public plans (`tenant_id IS NULL`).
  - Uses Automapper DTO mapping and Redis caching.
  - Comparison/annual savings and recommendation logic can be added in a later pass.

---

## Phase 3 – Subscription Management (`BILLING.md` §78–130)

> The core "subscription checkout + webhook" flow is implemented and tracked in section **0** above.
> The items below cover **remaining work and alignment** with `BILLING.md` Phase 3.

- [ ] 3.1 GET subscription endpoint per spec
  - `GET /billings/subscription` to fetch subscription details from Stripe.
  - Include current usage metrics, trial status and days remaining.
  - Return a `SubscriptionDTO` matching the spec.

- [ ] 3.2 Subscription checkout – additional features
  - Align with `BILLING.md` 3.2 (e.g. coupon validation, any extra metadata requirements).
  - Ensure all plan types (Free, Starter, Growth, Enterprise) are supported and documented.

- [ ] 3.3 Webhook behaviors beyond `add-subscription-checkout`
  - Any additional events (e.g. `subscription.created` vs `subscription.changed`) required by `BILLING.md`.
  - Confirmation email on successful subscription where applicable.

- [ ] 3.4 Upgrade flow
  - `POST /billings/subscription/upgrade` and upgrade preview endpoint.
  - Stripe subscription upgrade with proration.
  - Immediate tenant plan update, confirmation email, `subscription.upgraded` event.

- [ ] 3.5 Downgrade flow
  - `POST /billings/subscription/downgrade` plus cancel‑pending‑downgrade endpoint.
  - Usage vs plan‑limit validation.
  - Schedule change at period end in Stripe.
  - Email + `subscription.downgrade_scheduled` event.

- [ ] 3.6 Cancellation flow
  - `POST /billings/subscription/cancel` and reactivation endpoint.
  - Stripe cancel‑at‑period‑end and reactivation.
  - Store cancellation reason, send emails, handle expiry via webhook.
  - `subscription.cancelled` event.

- [ ] 3.7 Early upgrade during trial
  - Allow upgrading before trial ends.
  - Pro‑rate charges, end trial immediately, update trial status.

---

## Phase 4 – Payment & Invoice Management (`BILLING.md` §131–152)

- [ ] 4.1 Payment method management
  - Create Stripe SetupIntent for adding cards.
  - `POST /billings/payment-methods`, `GET /billings/payment-methods`, `DELETE /billings/payment-methods/:id`.
  - Handle payment method updates in Stripe.

- [ ] 4.2 Invoice management
  - `GET /billings/invoices` endpoint.
  - Stripe invoice listing and PDF download.
  - Upcoming invoice preview.

- [ ] 4.3 Payment failure handling
  - Handle `invoice.payment_failed` webhook with grace‑period logic.
  - Send failed payment notifications.
  - Payment‑required guard and restoration on `invoice.paid`.

---

## Phase 5 – Usage Tracking System (`BILLING.md` §153–218)

- [ ] 5.1 `UsageTracker` service
  - Track usage across metrics.
  - Store usage in DB with daily rollups.

- [ ] 5.2 Usage check middleware/guard
  - Intercept resource creation requests.
  - Block requests that exceed plan limits.

- [ ] 5.3 Increment/decrement on resource changes
  - Hook into campaign creation, team member adds, referral emails, referral links.

- [ ] 5.4 Monthly usage reset job
  - Scheduled job to archive monthly usage and reset counters.
  - Send usage summary emails.

- [ ] 5.5 Limit exceeded exception
  - Custom HTTP 402 with metric, current usage, limit and upgrade suggestions.

- [ ] 5.6 `GET /billings/usage` endpoint
  - Return current usage, limits, percentage used and history.

- [ ] 5.7 Redis counters for real‑time tracking
  - `RedisUsageService` with key structure and atomic INCR/DECR.
  - TTL management for counters and thresholds.

- [ ] 5.8 SQS consumer for referral events
  - `ReferralEventProcessor` consuming referral events, validating and tracking usage.

- [ ] 5.9 Daily usage calculation cron
  - Read Redis counters nightly, write snapshots to `TenantUsage`.
  - Check thresholds (80%, 100%) and emit notifications.

---

## Phase 6 – Limit Enforcement (`BILLING.md` §219–258)

- [ ] 6.1 Usage vs plan‑limit validation
  - Service to compare current usage against plan limits, including trials.

- [ ] 6.2 Limit exceeded exception wiring
  - Use a shared HTTP 402 exception with helpful upgrade messaging.

- [ ] 6.3 `BillingGuard` for automatic enforcement
  - `CanActivate` guard that checks subscription status and limits.
  - Returns 402 Payment Required when limits exceeded (respecting trial).

- [ ] 6.4 Hard cut‑off at limits
  - Apply `BillingGuard` to all resource‑creation endpoints.
  - Configurable grace percentage (e.g. 10%).

- [ ] 6.5 Leaderboard limiting
  - Limit leaderboard queries to top `leaderboard_entries`.
  - Add "Showing top X of Y (plan limit)" note.

- [ ] 6.6 `PlanLimitService` utility
  - `getPlanLimits`, `canPerformAction`, `getRemainingCapacity`, `enforceLimit` helpers.

---

## Phase 7 – Trial Management (`BILLING.md` §259–289)

- [ ] 7.1 Trial setup on tenant creation
  - Automatically set `trial_started_at` and `trial_ends_at` (default 14 days).
  - Initialize starter‑like plan limits during trial.

- [ ] 7.2 Trial expiry check
  - Middleware/guard that blocks actions when trial expired and no subscription.
  - Return clear error and redirect/URL for upgrade.

- [ ] 7.3 Trial reminder jobs
  - Reminder emails 3 days and 1 day before expiry; trial expired notification.

- [ ] 7.4 Trial expiry downgrade
  - Automatically downgrade to Free plan after trial.
  - Set reduced limits and update subscription status.

- [ ] 7.5 Early upgrade during trial
  - Allow upgrade before trial ends; end trial, handle proration and status updates.

---

## Phase 8 – Tenant Status Management (`BILLING.md` §291–340)

- [ ] 8.1 Admin suspend endpoint
  - `POST /admin/tenants/:id/suspend` to set status `suspended`, set `suspended_at`, publish `tenant.suspended`.

- [ ] 8.2 Campaign pausing on suspension
  - Listen for `tenant.suspended` in campaign service; pause active campaigns and stop email sends.

- [ ] 8.3 Suspension notification
  - Email notification to tenant admins with reason, duration and support contacts.

- [ ] 8.4 Unsuspend endpoint
  - Admin endpoint to restore tenants to `active` and resume paused campaigns.

- [ ] 8.5 Lock endpoint
  - `POST /tenants/:id/lock` to set status `locked` and require Ory password confirmation.

- [ ] 8.6 Unlock endpoint
  - Admin endpoint with Ory verification to unlock tenants, update status to `active`, send notification.

- [ ] 8.7 Auto‑unlock job
  - Scheduled job to automatically unlock tenants after configurable duration and send notification.

- [ ] 8.8 Tenant status guard
  - Guard/middleware to block requests for `suspended`/`locked` tenants and expose status via headers.

---

## Phase 9 – Analytics & Monitoring (`BILLING.md` §341–388)

- [ ] 9.1 ClickHouse schema for billing analytics
  - Tables for `billing_events`, `tenant_usage_daily`, `subscription_changes` with indexes and retention.

- [ ] 9.2 `ClickHouseService`
  - Connection pooling, batch inserts, common query helpers, error handling and health check.

- [ ] 9.3 Integrate ClickHouse with event processors
  - Log billing events, usage calculations, threshold crossings, subscription and payment events.

- [ ] 9.4 Billing analytics endpoints
  - `GET /billing/analytics/usage-trends`, `/revenue`, `/conversion`, `/debug/events` (admin‑only).

- [ ] 9.5 Monitoring and alerts
  - Metrics for billing usage and limits, failed webhooks, Redis usage, ClickHouse ingestion.
  - Alerting rules and Grafana dashboards.

- [ ] 9.6 Billing report generation
  - Monthly tenant usage reports, revenue and trial conversion reports.
  - CSV/PDF export and scheduled email delivery.
