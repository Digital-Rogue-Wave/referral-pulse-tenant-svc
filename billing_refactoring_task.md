# Billing Refactoring Tasks (Ordered)

> Traceability: This task file is the source for execution progress. Architecture docs are read-only; any new assumptions or pending approvals are noted here.

## 0. Guardrails (Must-Not-Change)
- [ ] Do not edit `docs/specs/*` or `docs/architecture.md`.
- [ ] Do not change code outside `src/billing` except for adding required enums/interfaces/types.
- [ ] Follow `toto-exemple` flow and existing `src/common/*` patterns.

## 1. Phase 1 — Discovery & Gap Analysis
- [ ] Inventory all billing module files (controllers, services, consumers, entities, queues, DTOs).
- [ ] Map current billing flow to `toto-exemple` flow (transaction boundaries, side effects ordering).
- [ ] Identify `@mod/*` imports that must move to the new `@app/*` or `src/common/*` paths.
- [ ] List external integrations (Stripe, Redis, SNS/SQS, audit, monitoring) and where they occur in the flow.
- [ ] Identify cross-module dependencies that block extraction (tenant, shared entities, services).
- [ ] Note required enums/interfaces/types to add (if missing).

### Phase 1 Findings (In Progress)
- **Inventory (partial):**
  - Module: `src/billing/billing.module.ts`
  - Services: `billing.service.ts`, `stripe.service.ts`, `plan.service.ts`, `usage-tracker.service.ts`, `plan-limit.service.ts`, `redis-usage.service.ts`, `daily-usage-calculator.service.ts`, `monthly-usage-reset.service.ts`, `payment-status-escalation.service.ts`, `trial-lifecycle.service.ts`, `billing-queue.service.ts`
  - Controllers: `billing.controller.ts`, `plan-admin.controller.ts`, `plan-public.controller.ts`, `test-billing.controller.ts`, `usage-internal.controller.ts`, `internal-tenant-status.controller.ts`, `stripe-redirect.controller.ts`
  - Consumers/Listeners: `listeners/billing.listener.ts`, `listeners/referral-events.consumer.ts`, `processors/billing-usage.processor.ts`
  - Entities: `billing.entity.ts`, `plan.entity.ts`, `tenant-usage.entity.ts`, `billing-event.entity.ts`
  - DTOs: `src/billing/dto/*`
  - Guards/Decorators: `guards/*`, `decorators/*`
- **Import paths:** current billing uses `@mod/*` paths (e.g., `@mod/common/...`, `@mod/tenant/...`) and must align with `src/common/*` and `toto-exemple` patterns.
- **Flow gap:** billing uses `EventEmitter2` and direct SNS publish via `SnsPublisher` in `BillingListener`; needs alignment to `TransactionEventEmitterService` + `SideEffectService` pattern from `toto-exemple`.
- **External integrations observed:** Stripe (`stripe.service.ts`), Redis usage tracking, SNS publish (billing.listener), SQS consumer (`referral-events.consumer.ts`), BullMQ queue (`billing-usage.processor.ts`), audit/monitoring services.
- **@mod path spread:** ~38 billing files import `@mod/*` paths (notably in services, controllers, entities, guards, listeners). These will need alignment to `src/common/*` and `toto-exemple` patterns once target paths are confirmed.
- **Cross-module dependencies (extraction risk):** `@mod/tenant/*` services/entities (tenant stats, tenant entity), audit/monitoring modules, idempotency service, and shared enums under `@mod/common/enums`.
- **Flow mapping (current vs toto):**
  - Current billing emits domain events via `EventEmitter2` (`billing.service.ts`, `trial-lifecycle.service.ts`, `payment-status-escalation.service.ts`, `monthly-usage-reset.service.ts`).
  - SNS publish is handled in `listeners/billing.listener.ts` using `SnsPublisher` (direct publish, no outbox).
  - SQS consumption: `listeners/referral-events.consumer.ts` processes `analytics-events` queue with manual envelope parsing and Redis usage update.
  - Scheduled jobs: `billing-queue.service.ts` + `processors/billing-usage.processor.ts` run periodic billing jobs via BullMQ.
  - **Target alignment:** shift to `TransactionEventEmitterService.emitAfterCommit` + `SideEffectService` (outbox for critical) per `toto-exemple`, and standardize SQS consumption with `MessageProcessorService`.
- **Key @mod import hotspots (examples):**
  - `billing.service.ts`: billing enums, idempotency, monitoring, audit, tenant services.
  - `billing.listener.ts`: `@mod/common/aws-sqs/sns.publisher`, DTOs, monitoring.
  - `trial-lifecycle.service.ts`: tenant entity, enums, Redis service/key builder.
  - `plan.service.ts`: Redis service/key builder, config types.
  - `processors/billing-usage.processor.ts` + `billing-queue.service.ts`: BullMQ queue constants, config types.
- **Concrete @mod import locations to migrate (file list):**
  - Controllers: `billing.controller.ts`, `plan-admin.controller.ts`, `plan-public.controller.ts`, `test-billing.controller.ts`, `usage-internal.controller.ts`, `internal-tenant-status.controller.ts`, `stripe-redirect.controller.ts`.
  - Services: `billing.service.ts`, `stripe.service.ts`, `plan.service.ts`, `plan-limit.service.ts`, `usage-tracker.service.ts`, `redis-usage.service.ts`, `trial-lifecycle.service.ts`, `daily-usage-calculator.service.ts`, `monthly-usage-reset.service.ts`, `payment-status-escalation.service.ts`.
  - Queue/Processor: `billing-queue.service.ts`, `processors/billing-usage.processor.ts`.
  - Listeners/Consumers: `listeners/billing.listener.ts`, `listeners/referral-events.consumer.ts`.
  - Entities/DTOs/Guards: `billing.entity.ts`, `billing-event.entity.ts`, `plan.entity.ts`, `tenant-usage.entity.ts`, `dto/*.ts`, `guards/*.ts`.
- **Enums / interfaces / types to map or add (if missing in new common paths):**
  - Billing enums: `BillingPlanEnum`, `SubscriptionStatusEnum`, `PaymentStatusEnum`.
  - Tenant enums: `TenantStatusEnum`.
  - Billing event interfaces: `SubscriptionCreatedEvent`, `SubscriptionUpgradedEvent`, `SubscriptionDowngradeScheduledEvent`, `SubscriptionCancelledEvent`, `SubscriptionChangedEvent`, `TenantPaymentStatusChangedEvent`.
  - Auth/guards/types: `JwtAuthGuard`, `KetoGuard`, `RequirePermission`, `KetoNamespace`, `KetoRelation`, `Public`.
  - Shared utilities/types: `EntityHelper`, `NullableType`, `PaginatedDto`, `ClsRequestContext`, `AllConfigType`.

## 2. Phase 2 — Target Architecture Alignment
- [ ] Define target billing module layout to mirror `toto-exemple` (module/service/consumer/controllers).
- [ ] Define billing domain events (names and payloads) aligned with existing event types.
- [ ] Define SNS/SQS usage for billing events (topic/queue names from architecture docs).
- [ ] Define ordering for transactional flow: DB → outbox → after-commit events → Redis/side effects.

### Phase 2.1 — Target Billing Module Layout (Mirror `toto-exemple`)

#### Target folder layout (billing-only)
- **Module entrypoint**
  - `src/billing/billing.module.ts` (similar role to `src/toto-exemple/toto.module.ts`)
- **HTTP API layer**
  - Controllers stay under `src/billing/*controller.ts`
  - Keep public vs admin vs internal boundaries explicit (as currently)
- **Application services (orchestrate use-cases)**
  - `src/billing/billing.service.ts` (subscription lifecycle + payment status changes)
  - `src/billing/plan.service.ts` + `plan-limit.service.ts`
  - `src/billing/usage-tracker.service.ts`
- **Infrastructure adapters (integrations)**
  - Stripe adapter: `src/billing/stripe.service.ts`
  - Redis usage/cache adapter: `src/billing/redis-usage.service.ts`
- **Messaging**
  - SQS consumers: move/keep under `src/billing/consumers/*` (mirror `toto.consumer.ts` intent)
  - Event listeners (local, after-commit): keep under `src/billing/listeners/*` but refactor to use the same event emission/side-effect patterns as `toto-exemple`
- **Background jobs**
  - Queue scheduling: `src/billing/billing-queue.service.ts`
  - Worker: `src/billing/processors/billing-usage.processor.ts`
- **Persistence**
  - Entities: `src/billing/*.entity.ts` (as-is)
  - Repository pattern: migrate to tenant-aware repository pattern used by `toto-exemple` (provider wiring in module)
- **Contracts**
  - DTOs remain under `src/billing/dto/*` for HTTP
  - Domain events + shared payload contracts should move to `src/domains/billing/*` in Phase 3 when extractability is implemented

#### Mapping from current billing files → target responsibilities
- **Controllers**
  - `BillingController` / `StripeRedirectController`: subscription + checkout flows
  - `PlanAdminController` / `PlanPublicController`: plan CRUD/read
  - `UsageInternalController` / `InternalTenantStatusController`: internal ops
- **Messaging (needs alignment to `toto-exemple`)**
  - Current: `listeners/billing.listener.ts` publishes SNS directly
  - Target: billing services emit after-commit events; a single place creates side-effects via `SideEffectService` (outbox for critical)
  - Current: `listeners/referral-events.consumer.ts` consumes SQS with manual parsing
  - Target: use the same envelope + idempotency + metrics approach as `toto.consumer.ts` via `MessageProcessorService`
- **Jobs**
  - `BillingUsageQueueService` schedules repeatable jobs (monthly reset, daily snapshot, payment escalation, trial lifecycle, optional plan sync)
  - `BillingUsageProcessor` routes jobs to corresponding services

#### Notes / constraints
- Keep existing endpoints behavior stable during refactor; only move code/structure and swap internal mechanics to match template.
- Any new directories introduced under `src/billing/*` must remain billing-scoped (to keep extractability easy).

### Phase 2.2 — Billing Domain Events (Names + Payloads)

#### Naming rules
- Use event types that already exist in the current billing code where possible (e.g., `subscription.created`, `tenant.payment_status.changed`) to avoid breaking existing consumers.
- If/when we introduce a new billing-specific namespace (e.g., `billing.*`), document it as **NOTE: Pending approval** and keep publishing the legacy event types until the boss approves a migration.

#### Event list (based on current billing emissions)
- **Subscription lifecycle**
  - `subscription.created`
    - Payload: `{ tenantId, billingPlan, subscriptionStatus, stripeCustomerId?, stripeSubscriptionId?, createdUserId? }`
  - `subscription.changed`
    - Payload: `{ tenantId, billingPlan, subscriptionStatus, stripeCustomerId?, stripeSubscriptionId?, stripeEventId? }`
  - `subscription.upgraded`
    - Payload: `{ tenantId, previousPlan, billingPlan, subscriptionStatus, stripeCustomerId?, stripeSubscriptionId?, upgradeUserId?, ... }`
  - `subscription.downgrade_scheduled`
    - Payload: `{ tenantId, previousPlan, billingPlan, subscriptionStatus, stripeCustomerId?, stripeSubscriptionId?, downgradeUserId?, effectiveDate }`
  - `subscription.cancelled`
    - Payload: `{ tenantId, previousPlan, billingPlan, subscriptionStatus, stripeCustomerId?, stripeSubscriptionId?, cancelUserId?, cancellationReason?, cancellationEffectiveDate? }`

- **Payment & tenant state**
  - `tenant.payment_status.changed`
    - Payload: `{ tenantId, previousStatus, nextStatus, changedAt, source, stripeEventId?, stripeCustomerId?, stripeSubscriptionId?, stripeInvoiceId?, stripePaymentIntentId?, nextPaymentAttemptAt? }`

- **Usage**
  - `usage.threshold_crossed`
    - Payload (current behavior-driven): `{ tenantId, metric, threshold, currentUsage, triggeredAt, window? }`
  - `usage.monthly_summary`
    - Payload: `{ tenantId, month, metrics: [{ metric, usage, limit? }], triggeredAt }`

- **Trial lifecycle**
  - `trial.reminder`
    - Payload: `{ tenantId, trialEndsAt, daysRemaining, triggeredAt }`
  - `trial.expired`
    - Payload: `{ tenantId, trialEndsAt, triggeredAt }`

#### Traceability notes
- These event types are derived from current code (`BillingService`, `BillingListener`, scheduled jobs) and must remain aligned with `docs/architecture.md` naming. We do not change architecture docs; we only record any mismatches here as notes.

### Phase 2.3 — SNS/SQS Usage (Topics/Queues)

#### Source-of-truth inputs used (read-only)
- `docs/EVENT_ARCHITECTURE.md` (hybrid event architecture + example queue names)
- `docs/specs/microservices-architecture.md` (Tenant Service “Events Published” list)
- `src/config/aws.config.ts` (how SQS queues are derived from env vars)
- `deployment/helm/values.yaml` and `.env.example` (SQS_QUEUE_* variables)
- `src/types/app.type.ts` (type-level queue/topic name lists)

#### Current billing implementation (as-is)
- **SNS publishing (billing → platform):**
  - File: `src/billing/listeners/billing.listener.ts`
  - Uses `SnsPublisher` to publish to topic name: `referral-platform-events`
  - Published event types include: `subscription.*`, `payment.*`, `tenant.*`, `usage.*`, `trial.*`
- **SQS consuming (analytics/referral → billing):**
  - File: `src/billing/listeners/referral-events.consumer.ts`
  - Consumes queue name: `analytics-events`
  - Filters `referral.*` events and updates usage via Redis + persists `BillingEventEntity`

#### Environment/config-driven queue naming (what the template expects)
- SQS queues are provided via env vars `SQS_QUEUE_{NAME}`.
  - Example: `SQS_QUEUE_ANALYTICS_EVENTS=.../analytics-events.fifo`
- `src/config/aws.config.ts` derives the queue name by lowercasing and converting `_` → `-`.
  - Therefore `SQS_QUEUE_ANALYTICS_EVENTS` becomes queue name `analytics-events`.
  - **Result:** billing’s current `@SqsMessageHandler('analytics-events', ...)` aligns with the env-derived queue naming.

#### Known mismatches / traceability notes (no architecture doc changes)
- **NOTE: SNS topic naming mismatch**
  - Billing publishes to `referral-platform-events`.
  - `src/types/app.type.ts` lists `SnsTopicName` as `toto-events-topic`, `campaign-events-topic`, `referral-events-topic`, `user-events-topic`, `system-notifications-topic` and does **not** include `referral-platform-events`.
  - Action later (Phase 3+): keep current behavior until boss confirms the platform-wide SNS topic naming; then align billing to the approved topic name using existing common patterns.
- **NOTE: Queue naming mismatch across docs vs code vs types**
  - `docs/EVENT_ARCHITECTURE.md` examples use `analytics-events-queue`.
  - Billing code uses `analytics-events`.
  - `src/types/app.type.ts` includes `analytics-queue` (and not `analytics-events`).
  - The env (`SQS_QUEUE_ANALYTICS_EVENTS`) indicates `analytics-events.fifo` → queue name `analytics-events` (by current config extraction).
  - Action later: do not rename infrastructure; instead, update local typing/contracts if needed (allowed: add types) so that code and config remain consistent.

#### Provisional mapping (until boss confirms SNS topic list)
- **SQS queue for analytics events:** `analytics-events` (from `SQS_QUEUE_ANALYTICS_EVENTS`)
- **SNS topic for platform events:** currently `referral-platform-events` (keep until confirmed)

#### Pending confirmations
- Confirm which SNS topic name is canonical for “tenant/billing/platform events” in this repo’s deployed environments.
- Confirm whether queue names should include `-queue` suffix, or if `analytics-events` is canonical (current env/config suggests `analytics-events`).

### Phase 2.4 — Transactional Ordering Template (DB → Outbox → After-Commit → Redis/External)

#### Goal
- Guarantee **transactional consistency** of billing writes.
- Ensure all **side effects are rollback-safe**, with **critical cross-service messaging guaranteed**.

#### Invariants (must hold for all billing write flows)
- All DB changes for a “business decision” are performed in a single DB transaction.
- **Critical** cross-service messaging is recorded via outbox (**inside the DB transaction**) so it is atomic with the DB state.
- **Non-critical** side effects run **after commit** (acceptable to fail without rolling back billing state).
- Redis writes are treated as **cache/derived state**, so they happen **after commit** and are idempotent/rebuildable.
- External IO (Stripe, HTTP, SNS/SQS direct sends, etc.) happens **after commit** unless the flow is explicitly designed as a multi-step saga (see below).

#### Reference pattern (from `toto-exemple`)
- Inside `@Transactional()`:
  - DB save
  - `SideEffectService.create{Sns|Sqs}SideEffect(..., { critical: true })` for guaranteed delivery (outbox)
  - `TransactionEventEmitterService.emitAfterCommit(...)` for non-critical in-process listeners
- After commit:
  - Redis caching
  - External HTTP calls (best-effort)

#### Canonical ordering (single-step flows)
1. **DB mutation (transaction)**
   - Create/update billing entities (`subscription`, `tenant_usage`, `billing_event`, etc.).
2. **Outbox record(s) (transaction)**
   - Use `SideEffectService` for SNS/SQS with `{ critical: true }` when downstream systems must be notified reliably.
3. **Emit non-critical domain events (after commit)**
   - `txEventEmitter.emitAfterCommit('billing.*', new ...)`.
4. **Redis + other derived state (after commit)**
   - Cache updates, counters, usage snapshots.
5. **External IO (after commit)**
   - Stripe API calls (when not required to decide DB state), HTTP integrations, etc.

#### When external IO is required to decide DB state (Stripe-first / multi-step)
Some billing operations require an external provider response (e.g., Stripe) before you can finalize local state. To preserve the “side effects last” intent, use a **two-step saga**:

1. **Step A (transaction): create a local intent / pending record**
   - Persist a durable record representing the request (e.g., `BillingOperation` / `SubscriptionChangeRequest`) with status `pending`.
   - Store idempotency key + correlation IDs.
   - Commit.
2. **Step B (external call, after commit): call Stripe**
   - Use Stripe idempotency key.
   - If call fails: keep operation `pending` and retry via job (BullMQ) or manual replay.
3. **Step C (transaction): finalize local state**
   - Update subscription/payment state using Stripe response.
   - Record outbox side effect(s) **inside this finalize transaction**.
   - Emit after-commit events for non-critical listeners.

Traceability note: This aligns with the architecture constraint “side effects last” while acknowledging that some business decisions are inherently external-provider-driven.

#### Redis ordering rules (billing)
- Redis writes are **never** the source of truth for billing decisions.
- Redis updates must be:
  - Idempotent
  - Safe to run multiple times
  - Safe to recompute from DB if Redis is flushed

#### Messaging placement rules (billing)
- Use outbox (`SideEffectService` with `{ critical: true }`) when:
  - Downstream services must not miss the event (state sync, enforcement, workflows).
- Use `emitAfterCommit` + listeners (non-critical) when:
  - Metrics, analytics, audit logs, notifications that can be retried independently.

#### Concrete “apply this” checklist for Phase 3
- For each billing write path (create/upgrade/downgrade/cancel subscription, payment status escalation, trial transitions):
  - Ensure the DB write is wrapped in `@Transactional()` (or explicit query runner).
  - Move critical SNS/SQS publish intent into outbox creation inside the transaction.
  - Move Redis writes to after-commit listeners or post-commit steps.
  - Ensure Stripe/external calls are either:
    - After commit (preferred), or
    - Implemented via the two-step saga above.
- For each consumer/listener that writes DB:
  - Ensure idempotency is enforced (message id / event id / dedupe key).

## 3. Phase 3 — Refactor Execution (Step-by-Step)
- [ ] Update module wiring to use `MessagingModule`, `RedisModule`, and common providers as per template.
- [ ] Refactor BillingService critical write paths to use `@Transactional` and `emitAfterCommit`.
- [ ] Replace direct SNS/SQS calls with `SideEffectService` (outbox for critical, direct for non-critical).
- [x] Standardize SQS consumers on `MessageProcessorService` (idempotency + metrics).
- [ ] Move billing events + DTOs under shared domain location (if needed for extraction).
- [ ] Ensure Redis side effects occur last and are rollback-safe.

#### Phase 3 traceability notes
- Refactor slice completed: `src/billing/listeners/referral-events.consumer.ts` now uses `MessageProcessorService.process()` (envelope parsing + tenant context + idempotency + metrics).

## 4. Phase 4 — Validation
- [ ] Confirm no changes outside billing (except enums/interfaces/types).
- [ ] Verify event names and queues match architecture docs.
- [ ] Run tests relevant to billing and consumers (if available).
- [ ] Update this task file with completion notes and any pending approvals.
