# Billing Module Tasks – Phases 1–9

Canonical feature list: `BILLING.md` (Phases 1–9)
- Treat `BILLING.md` as the primary backlog / source of truth for billing tickets.
- Always add or refine work items in `BILLING.md` first, then reflect them here.
- If there is ever a mismatch, **BILLING.md takes priority** and this file must be updated to match it.
Supporting spec: `openspec/changes/add-subscription-checkout/specs/tenant-billing/spec.md`

Status legend:
- `[x]` Implemented in this repo and matches current spec/behavior.
- `[ ]` Not implemented yet or needs refactor/extension to meet the spec.

This checklist is intended to be **kept up to date as implementation progresses**.

Architecture note:
- All billing-related endpoints, services and data access should live under the **billing** domain (e.g. `BillingModule`, `/billings` routes).
- Assume billing may be extracted into a separate microservice later; avoid putting billing logic into tenant, campaign or other modules to minimize refactoring.
- Per architecture, authenticated requests flow through Ory (Hydra) + Keto authorization, so `tenant-id` should be available in request context for all non-public routes.

Architecture ownership note (source of truth: `docs/specs/microservices-architecture.md`):
- Tenant Service owns billing state transitions and publishes events.
- Integration Service owns emails/notifications and reacts to events.
- Campaign Service reacts to tenant billing/status events to pause/resume campaigns.

## Refactor – Architecture Alignment (src/billing)

- [x] A1 Remove direct email sending from billing domain
  - Tenant Service should publish events only; Integration Service sends emails/notifications.

- [x] A2 Align Stripe webhook route with architecture
  - Architecture specifies `POST /webhooks/stripe`.
  - Current implementation supports `POST /webhooks/stripe` (see `src/webhook/webhooks.controller.ts`) while keeping `POST /api/v1/webhook/stripe` (see `src/webhook/webhook.controller.ts`) for backward compatibility.

- [x] A3 Align billing event names with architecture
  - Architecture event contracts include: `payment.failed`, `payment.restored`, `tenant.restricted`, `tenant.locked`, `tenant.restored`.
  - Current implementation uses: `billing.payment_failed`, `tenant.payment_status.changed`.
  - Add/rename events to match the boss contract (and keep internal ones only if necessary).

- [x] A4 Align SNS topic + event envelope schema with architecture
  - Architecture describes SNS topic `referral-platform-events` and an envelope that includes top-level `tenantId`.
  - Current implementation publishes to topic `tenant-events` and uses `eventId = tenantId`.
  - Update publishing to:
    - Use a unique `eventId` per event.
    - Include `tenantId` in the envelope (not only inside `data`).
    - Publish to the correct topic.

- [x] A5 Emit publishable events for usage threshold + monthly summary
  - `DailyUsageCalculator` writes `BillingEventEntity` rows (`usage.threshold_crossed`) but does not publish an event.
  - `MonthlyUsageResetService` writes `BillingEventEntity` rows (`usage.monthly_summary`) but does not publish an event.
  - Emit events so Integration Service can notify.

- [x] A6 Confirm billing route auth matches architecture
  - Auth is enforced globally via `APP_GUARD` (`JwtAuthGuard` then `KetoGuard`).

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

- [x] 0.3 `POST /webhooks/stripe` – successful `checkout.session.completed`
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

- [x] 0.4 `POST /webhooks/stripe` – invalid signature handling
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

> Note: Fresh database bootstrap is handled by an initial migration (`InitCoreSchema1734250000000`) so `pnpm migration:run` can be executed against an empty Postgres database.

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

- [x] 2.4 Stripe Products/Prices sync
  - Sync Stripe Products/Prices into `PlanEntity`.
  - Update `stripe_price_id`, `stripe_product_id`, limits and metadata.
  - Handle new/updated/deleted products.
  - **Status:** Implemented in `PlanStripeSyncService` and wired to a repeatable BullMQ job.

- [x] 2.4.1 (optional) BullMQ-based recurring sync job
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

- [x] 3.1 GET subscription endpoint per spec
  - `GET /billings/subscription` to fetch subscription details from Stripe.
  - Include current usage metrics, trial status and days remaining.
  - Return a `SubscriptionDTO` matching the spec.

- [x] 3.2 Subscription checkout – additional features
  - Align with `BILLING.md` 3.2 (e.g. coupon validation, any extra metadata requirements).
  - Ensure all plan types (Free, Starter, Growth, Enterprise) are supported and documented.

- [x] 3.3 Webhook behaviors beyond `add-subscription-checkout`
  - Any additional events (e.g. `subscription.created` vs `subscription.changed`) required by `BILLING.md`.
  - Publish billing events; Integration Service sends confirmation emails/notifications where applicable.

- [x] 3.4 Upgrade flow
  - `POST /billings/subscription/upgrade` and upgrade preview endpoint.
  - Stripe subscription upgrade with proration.
  - Immediate tenant plan update and `subscription.upgraded` event; Integration Service sends confirmation emails/notifications.

- [x] 3.5 Downgrade flow
  - `POST /billings/subscription/downgrade` endpoint (REFER-279) plus cancel‑pending‑downgrade endpoint (REFER-281).
  - Usage vs plan‑limit validation (REFER-278).
  - Schedule Stripe subscription change for period end (REFER-280).
  - Store pending downgrade in database (REFER-281).
  - Publish downgrade scheduled event; Integration Service sends downgrade notifications.
  - Publish `subscription.downgrade_scheduled` event (REFER-283).

- [x] 3.6 Cancellation flow
  - `POST /billings/subscription/cancel` and reactivation endpoint.
  - Stripe cancel‑at‑period‑end and reactivation.
  - Store cancellation reason, publish events, handle expiry via webhook; Integration Service sends cancellation emails/notifications.
  - `subscription.cancelled` event.
  - After cancellation becomes effective, tenant loses access to new billing‑dependent actions and analytics; only historical subscription data remains visible.
  - Cancelled tenant data remains persisted but hidden in the application for a limited retention window (e.g. ~1 month) and becomes visible again only if the tenant upgrades/reactivates within that window.
  - After the retention window, relevant tenant billing artefacts are soft‑deleted (interim behavior) while long‑term analytics retention is governed by Phase 9 data retention policies in `BILLING.md`.

- [x] 3.7 Early upgrade during trial
  - Allow upgrading before trial ends.
  - Pro‑rate charges, end trial immediately, update trial status.

- [x] 3.8 Remove in-service email sending from billing flows
  - Tenant Service publishes billing events only.
  - Integration Service consumes events and sends emails/notifications.
  - Remove direct SES email sends from `BillingListener` in this repo.

---

## Phase 4 – Payment & Invoice Management (`BILLING.md` §131–152)

- [x] 4.1 Payment method management
  - Create Stripe SetupIntent for adding cards.
  - `POST /billings/payment-methods`, `GET /billings/payment-methods`, `DELETE /billings/payment-methods/:id`.
  - Handle payment method updates in Stripe.

- [x] 4.2 Invoice management
  - `GET /billings/invoices` endpoint.
  - Stripe invoice listing and PDF download.
  - Upcoming invoice preview.

- [x] 4.3 Payment failure handling
  - Handle `invoice.payment_failed` webhook with grace‑period logic.
  - Publish payment failure events; Integration Service sends failed payment notifications.
  - Payment‑required guard and restoration on `invoice.paid`.

- [x] 4.4 Internal tenant billing status endpoint (architecture contract)
  - Implement `GET /internal/tenants/:id/status` for other services.
  - Response should include tenant `status`, payment enforcement state, plan and subscription status.
  - Used by other services for fast allow/deny decisions and caching.
  - Tasks:
    - Define a stable DTO/response schema (versionable) for cross-service consumption.
    - Enforce service-to-service auth (service token + Keto policy).
    - Source-of-truth fields:
      - Tenant: `status`, `paymentStatus`, `trialStartedAt`, `trialEndsAt`.
      - Billing: `plan`, `status` (subscription status), Stripe identifiers if needed.
    - Ensure safe behavior when a tenant has no `BillingEntity` (default plan enforcement).

- [x] 4.5 Align `payment_status` with architecture state machine
  - Architecture expects: `active | past_due | restricted | locked`.
  - Current implementation models: `pending | completed | failed`.
  - Requires enum + DB migration + guard behavior updates (breaking).
  - Required direction: full alignment in tenant-svc.
  - Tasks:
    - Update `PaymentStatusEnum` to: `ACTIVE`, `PAST_DUE`, `RESTRICTED`, `LOCKED`.
    - Add DB migration for tenant `payment_status` values (map existing values deterministically).
    - Persist timestamps to support deterministic transitions (e.g. `paymentPastDueAt` / `lastPaymentFailureAt`).
    - Stripe webhook mapping:
      - `invoice.payment_failed` => set `paymentStatus=PAST_DUE` and record start timestamp.
      - `invoice.paid` => set `paymentStatus=ACTIVE` and clear/close failure window.
    - Transition mechanism:
      - Scheduled job to move `PAST_DUE -> RESTRICTED -> LOCKED` based on elapsed time.
    - Enforcement behavior:
      - Update `PaymentRequiredGuard` to enforce per-state behavior.
    - Events for workflow side effects:
      - Publish payment/account-state transition events for Temporal workflows (emails, campaign pausing).

---

## Phase 5 – Usage Tracking System (`BILLING.md` §153–218)
 
 - [x] Docs: Example of applying `PaymentRequiredGuard` to protected routes.

 - [x] 5.1 `UsageTracker` service
  - Track usage across metrics.
  - Store usage in DB with daily rollups.

- [x] 5.2 Usage check middleware/guard
  - Intercept resource creation requests.
  - Block requests that exceed plan limits.

- [x] 5.3 Increment/decrement on resource changes
  - Provide internal usage tracking API for other services (e.g. `POST /internal/tenants/:tenantId/usage/increment|decrement`) that delegates to the usage tracking layer.
  - Define metrics for campaigns, team members, referral emails, referral links.
  - Ensure campaign, team-member, referral and other services increment on create and decrement on delete via the usage API.

- [x] 5.4 Monthly usage reset job
  - Scheduled job to archive monthly usage and reset counters.
  - Archive final monthly usage into `TenantUsageEntity` and `BillingEventEntity`.
  - Reset Redis monthly counters and usage thresholds for the new billing period.
  - Publish usage summary events; Integration Service sends usage summary emails/notifications.

- [x] 5.5 Limit exceeded exception
  - Custom HTTP 402 with metric, current usage, limit and upgrade suggestions.

- [x] 5.6 `GET /billings/usage` endpoint
  - Return current usage, limits, percentage used and history.

- [x] 5.7 Redis counters for real‑time tracking
  - Implement `RedisUsageService` with atomic INCR/DECR operations.
  - Define Redis key structure (e.g. `usage:{tenant_id}:{metric}:{YYYY-MM}`, `limits:{tenant_id}:{metric}`, `thresholds:{tenant_id}:{metric}:{percentage}`).
  - TTL management for counters and thresholds (auto-expire after a retention window).

- [x] 5.8 SQS consumer for referral events
  - `ReferralEventProcessor` consuming referral events from SQS, validating payloads and calling the usage tracking layer (e.g. `RedisUsageService.trackUsage()`).
  - Align event schema with SNS/SQS setup and emit analytics events as needed.

- [x] 5.9 Daily usage calculation cron
  - Read Redis counters nightly and write snapshots to `TenantUsageEntity`.
  - Check thresholds (80%, 100%) and publish notification-worthy events; Integration Service sends notifications.
  - Archive or reset Redis keys as needed to keep counters bounded.

---

## Phase 6 – Limit Enforcement (`BILLING.md` §219–258)

- [x] 6.1 Usage vs plan‑limit validation
  - Service to compare current usage against plan limits, including trials.

- [x] 6.2 Limit exceeded exception wiring
  - Use a shared HTTP 402 exception with helpful upgrade messaging.

- [x] 6.3 `BillingGuard` for automatic enforcement
  - `CanActivate` guard that checks subscription status and limits.
  - Returns 402 Payment Required when limits exceeded (respecting trial).

- [x] 6.4 Hard cut‑off at limits
  - Apply `BillingGuard` to all resource‑creation endpoints.
  - Configurable grace percentage (e.g. 10%).

- **(External)** 6.5 Leaderboard limiting
  - Limit leaderboard queries to top `leaderboard_entries`.
  - Add "Showing top X of Y (plan limit)" note.
  - Note: in this repo, only a demo endpoint exists under `TestBillingController`; there is no real leaderboard read/query path here, so the actual limiting must be implemented in the service that owns leaderboard reads.
  > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is the service that owns the real leaderboard read/query path; tenant-svc can only provide plan limits + billing state.

- [x] 6.6 `PlanLimitService` utility
  - `getPlanLimits`, `canPerformAction`, `getRemainingCapacity`, `enforceLimit` helpers.
  - After `PlanLimitService` is implemented, refactor `UsageCheckGuard` / `UsageCheck` to derive limits from `PlanEntity.limits` via `PlanLimitService` instead of decorator-provided constants.
  - Implemented in referral-pulse-tenant-svc billing module (PlanLimitService, BillingGuard, UsageCheckGuard, billing test endpoints).

---

## Phase 7 – Trial Management (`BILLING.md` §259–289)

- [x] 7.1 Trial setup on tenant creation
  - Automatically set `trial_started_at` and `trial_ends_at` (default 14 days).
  - Initialize starter‑like plan limits during trial.

- [x] 7.2 Trial expiry check
  - Middleware/guard that blocks actions when trial expired and no subscription.
  - Return clear error and redirect/URL for upgrade.

- [x] 7.3 Trial reminder jobs
  - Tenant Service publishes events (or exposes internal signals) for trial reminder workflows; Integration Service sends reminder emails/notifications.

- [x] 7.4 Trial expiry downgrade
  - Automatically downgrade to Free plan after trial.
  - Set reduced limits and update subscription status.

- [x] 7.5 Early upgrade during trial
  - Allow upgrade before trial ends; end trial, handle proration and status updates.

---

## Phase 8 – Tenant Status Management (`BILLING.md` §291–340)

- [x] 8.1 Admin suspend endpoint
  - `POST /admin/tenants/:id/suspend` to set status `suspended`, set `suspended_at`, publish `tenant.suspended`.

- **(External)** 8.2 Campaign pausing on suspension
  - Campaign Service listens for `tenant.suspended` and pauses active campaigns / stops sends.
  > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Campaign Service.

- **(External)** 8.3 Suspension notification
  - Integration Service sends suspension email/notifications (consuming `tenant.suspended`) with reason, duration and support contacts.
  > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Integration Service.

- [x] 8.4 Unsuspend endpoint
  - Admin endpoint to restore tenants to `active` and resume paused campaigns.

- [x] 8.5 Lock endpoint
  - `POST /tenants/:id/lock` to set status `locked` and require Ory password confirmation.

- [x] 8.6 Unlock endpoint
  - Admin endpoint with Ory verification to unlock tenants and update status to `active`; Integration Service sends notifications.

- [x] 8.7 Auto‑unlock job
  - Scheduled job to automatically unlock tenants after configurable duration and publish events; Integration Service sends notifications.

- [x] 8.8 Tenant status guard
  - Guard/middleware to block requests for `suspended`/`locked` tenants and expose status via headers.

---

## Phase 9 – Analytics & Monitoring (`BILLING.md` §341–388)

> Note: Per `docs/specs/microservices-architecture.md`, ClickHouse storage and analytics endpoints live in the **Analytics Service**.
> In this repo, the tenant/billing module should focus on persisting billing state + usage snapshots and publishing events.

- **(External)** 9.1 ClickHouse schema for billing analytics
  - Tables for `billing_events`, `tenant_usage_daily`, `subscription_changes` with indexes and retention.
  > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Analytics Service.

- **(External)** 9.2 `ClickHouseService`
  - Connection pooling, batch inserts, common query helpers, error handling and health check.
  > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Analytics Service.

- **(External)** 9.3 Integrate ClickHouse with event processors
  - Log billing events, usage calculations, threshold crossings, subscription and payment events.
  > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Analytics Service (ingestion pipeline).

- **(External)** 9.4 Billing analytics endpoints
  - `GET /billing/analytics/usage-trends`, `/revenue`, `/conversion`, `/debug/events` (admin‑only).
  > **Scope/Owner:** Out of scope for Tenant Service microservices update. Owner is Analytics Service.

- **(External)** 9.5 Monitoring and alerts
  - Metrics for billing usage and limits, failed webhooks, Redis usage, ClickHouse ingestion.
  - Alerting rules and Grafana dashboards.
  > **Scope/Owner:** Cross-service. Tenant Service can expose metrics, but alerting/dashboards are owned by Platform/DevOps (and ClickHouse ingestion alerts by Analytics Service).

- **(External)** 9.6 Billing report generation
  - Monthly tenant usage reports, revenue and trial conversion reports.
  - CSV/PDF export and scheduled email delivery.
  > **Scope/Owner:** Cross-service. Analytics Service owns report generation; Integration Service owns scheduled delivery.

---

## Testing & Validation

- During the testing/QA phase, exercise billing flows (usage tracking, plan limits, monthly reset, trial behavior, leaderboard limiting) using the `TestBillingController` endpoints and billing guards to validate end-to-end behavior.
