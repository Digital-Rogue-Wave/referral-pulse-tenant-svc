# NOTE — Tenant & Billing Service: Spec Re-Alignment

Meeting-shareable log of spec inconsistencies, decisions, and cross-team contract items found while
re-aligning this service to the canonical template specs. Updated as the pass progresses.

Date of pass: 2026-06-17.

---

## Source of truth

**Superseded 2026-09-21:** the authoritative specs are the newer suite in `spec/` — API Contract v1.3,
Event Model v3, DB Model v2, Product Spec v4, System & Application Architecture, Failure & Observability
v3, Responsibility Contract v3. The `docs/` set below is kept read-only for history only.

The canonical specs previously lived (verbatim) in `docs/`:
`referralai_system_architecture_v1.md`, `referralai_db_tables_per_service.md`,
`referralai_event_model_v2.1.md`, `referralai_api_contract_v1.2.md`,
`referral_platform_product_spec.md`, `referralai_responsibility_contract_v2.md`,
`referralai_failure_observability_model_v2.md`, `docker-compose.yml`.
`docs/` and `docs/specs/` are READ-ONLY.

---

## Decisions — batch 2 (2026-09-21)

Ahmed's rule for this batch: where a ruling is open, implement the recommended production-grade option
and record it here, rather than wait. Every item below can be revisited; each names what was rejected.

### Authorization model (API Contract v1.3 §2) — tenant-service owns Ory Keto

| # | Decision | Why | Rejected |
|---|---|---|---|
| A1 | **The permission catalog is code** (`src/common/auth/authz/permission-catalog.ts`): the spec's 11 namespaces plus tenant-service's own `tenants` (read/write/delete), `users` (read/write), `billing` (read/write), `audit` (read). The Keto namespace config (`deployment/ory/keto/`) mirrors it and a spec fails on drift. | One definition drives tuples, the `perms` snapshot and the guards, so they cannot disagree. The spec table covers the other domains only. | Hand-maintained namespace list in infra. |
| A2 | **Role objects are tenant-scoped:** `role:{tenant_id}:{role}#member@user:{user_id}`; grants are subject sets `campaigns:{tenant_id}#write@(role:{tenant_id}:operator#member)`. | The spec example `role:operator#member` is global — an operator of tenant A would satisfy tenant B's grant. Verified on the running Keto that subject-set grants resolve transitively and deny outsiders. | Global role objects (spec example taken literally). |
| A3 | **Role matrix = API §2:** Owner all; Admin all except `billing:*` **and `tenants:delete`**; Operator and Viewer as specified **plus `tenants:read`**. | Deleting a tenant cancels the subscription and is irreversible — Owner-only. Every dashboard page reads the tenant profile. | Admin may delete the tenant. |
| A4 | **Live-check set** (never trusted from the JWT): the spec's `rewards:approve/reject/clawback`, `payouts:write/confirm`, `api_keys:manage`, plus `users:write`, `billing:write`, `tenants:delete`. Decisions cached 45 s in Redis (`keto:decision:*`, DB Model §3). | A stale token must not win on money, keys, membership or deletion. | Live Keto on every request. |
| A5 | **Keto subject = platform user ULID** (`user:{users.id}`); the Kratos identity id stays internal to credential resolution. | API §2 actor table (`user:{id}`), and `users.id` is the id on the wire. | Kratos identity id as subject. |
| A6 | **Platform scope:** `platform:referralai#admin@user:{id}` for staff routes (tenant suspend/unsuspend, plan catalog, currencies, circuit breakers). **Services:** `services:{capability}#call@service:{client_id}` for internal routes (`tenant_status.read`, `tenant_entitlements.read`, `tenant_contacts.read`, `tenant_verification.write`, `tenant.suspend`, `usage.write`). A route that lists only service capabilities is service-only — human tokens are refused. | Fixes #3 (a tenant Owner could suspend any tenant), #13/#14 (platform tables writable by tenants) and #4 (service tokens bypassed Keto). | The `allowServiceTokens` bypass. |
| A7 | **Internal JWT minted by tenant-service** at `GET /internal/validate-token` (Architecture §13.1). The gateway (Traefik forwardAuth, `authResponseHeaders: [Authorization]`) exchanges an API key or a Hydra user token for an ES256 JWT `{tenant_id, user_id, identity_id, source, key_type, key_id, perms}`, TTL 5 min (API key: 60 s). JWKS at `/.well-known/jwks.json`, `kid` = RFC 7638 thumbprint. The gateway authenticates with `X-Gateway-Secret`. Closed tenants are refused here. | The spec's design; `perms` is resolved once per token, not per request. | A Hydra token hook — it would put tenant logic inside Hydra's issuance and still leave API keys unsolved. |
| A8 | **Every service accepts two token kinds:** the internal JWT, and Hydra **client-credentials** tokens for mesh calls. A Hydra token for a human is rejected — dashboard traffic must pass the gateway. The tenant comes only from the verified token; the `x-tenant-id` header fallback is removed everywhere. | #4, #7. | Header-selected tenant. |
| A9 | **Membership is the write model, Keto is kept in sync:** `users` + `user_roles` change in a transaction; `tenant.created`, `user.registered`, `user.role_changed`, `user.removed` and `tenant.deleted` feed `KetoSyncListener`, which writes `keto` outbox side effects (idempotent tuple patches). A nightly `KetoReconcilerWorker` rewrites every live tenant's grants and memberships from the database. | Follows this repo's rule that services never call SideEffectService directly (`architecture.md`); the reconciler covers the crash window between commit and listener, and repairs drift. | Writing Keto inline (a Keto outage would fail signups). |

### Identity lifecycle

| # | Decision | Why |
|---|---|---|
| L1 | **One Ory identity belongs to exactly one tenant** — `users.kratos_identity_id` is globally unique (DB Model v2 §3). | Spec; makes token-time tenant resolution unambiguous. |
| L2 | **Onboarding** (Kratos after-registration hook `POST /v1/webhook/ory/signup`, or `POST /v1/tenants` for a signed-in identity with no tenant) creates the tenant, its Owner user and the role projection in **one transaction**. A replayed hook returns the existing tenant; a second tenant request gets 409. An address with a pending invitation gets **no** tenant — it joins through the invitation. | #8: signup used to create an ownerless tenant, and duplicates on retry. |
| L3 | **Role grants:** nobody grants `OWNER` directly (only ownership transfer, by the Owner); nobody grants above their own rank; nobody manages a peer or superior (except the Owner) or themselves; the last Owner/Admin cannot be removed or downgraded. | #5 role escalation. |
| L4 | **Removal** soft-deletes the member, clears the projection, revokes the Keto membership and ends every Ory session; emits `user.removed`. A removed identity may later join another tenant (the old row is replaced). | #6. |
| L5 | **Ownership transfer** promotes the target to Owner and demotes the previous Owner to Admin atomically. | #50: it only emitted an event before. |
| L6 | **Invitations** store only `sha256(token)`; the inviter's rank bounds the invited role; acceptance reads the invitee's email **from Kratos** (never from the token) and claims PENDING→ACCEPTED in the same transaction as the membership; emits `user.invited` (id and role only). | #33. |
| L7 | **Password confirmation** (lock/unlock) runs a Kratos native login flow and revokes the session it creates, with no retries and outside the circuit breaker. | Batch 1 called `/admin/identities/{id}/credentials/password/verify`, **which does not exist** (404 on the running Kratos) — lock/unlock could never succeed. |
| L8 | **Ory web hooks** authenticate with a mandatory ≥32-char `ORY_WEBHOOK_API_KEY`, compared in constant time. | #53: an empty value disabled the check. |

### Access tiers, uploads, test routes, outbox

| # | Decision | Why |
|---|---|---|
| G1 | **One global `TenantAccessGuard`** (one tenant read per request): suspended → 403 everywhere; self-locked → 403 except `@AllowLockedTenant` (unlock); payment-locked → 402 except `@AllowUnpaidTenant` (billing); restricted → read-only. | The per-controller guards read the tenant from request context, which is **empty while guards run** — the payment tiers never applied over HTTP. Also fixes #11 (unlock unreachable) and #12. |
| G2 | **One upload policy** for multipart and presigned uploads: png/jpeg/webp/gif/pdf, 10 MB; **SVG removed** (it can carry script). Presigned URLs sign the content type and exact byte size; ULID keys under the tenant prefix. File routes require `tenants:read/write`. | #49. |
| G3 | **`/test/*` billing routes register only with `ENABLE_TEST_ROUTES=true`.** | #46: they were live on staging. |
| G4 | **Outbox:** the queue client is injected by class; the worker claims rows atomically and retries a row not yet visible; `OutboxSweeperService` re-enqueues lost or stuck rows every minute; `effect_type` is `text` + CHECK (DB Model §0.3). | `SideEffectService` took its queue client through a string token **no module provided** — every critical side effect was written and never enqueued. Found during live verification. |

### API keys (API §2, DB Model v2 §3 `api_keys`)

| # | Decision | Why |
|---|---|---|
| K1 | **`key_hash` = HMAC-SHA256(`API_KEY_HASH_PEPPER`, raw key)**, unique; `key_prefix` = last 4 characters (`char(4)`, unique per tenant, regenerated on the rare clash). | The spec's Redis key `apikey:{key_prefix}:{key_hash8}` and `UNIQUE(key_hash)` need a deterministic hash. A 256-bit random key needs no slow hash; bcrypt forced comparing every key sharing a 4-char suffix (a CPU-DoS vector). The pepper keeps a database leak alone useless. |
| K2 | **Keys issued before 2026-09-21 were revoked** by migration `20260921210000_api_key_hmac_hash`. | Their raw values are unknown, so they cannot be re-hashed; no production keys existed. |
| K3 | **Validation cache** `apikey:{prefix}:{hash8}` for 300 s; revoke and rotate delete it, so a revoked key stops at once. The gateway exchange no longer caches API keys separately. | DB Model §3 Redis; #10. |
| K4 | **`scopes` removed** from keys, DTOs, responses and events. Keys are gated by type only and never carry permissions. | #21, API §2 "keys are never Keto subjects". |
| K5 | **`api_key.rotated`** is published on rotation; **`api_key.revoked`** carries the optional `?reason=` of the DELETE. `last_used_at` is written at most once a minute per key. | #27, #20, #10. |
| K6 | Responses list their fields explicitly — the key hash was being returned by create/rotate. | Found during live verification. |

### HTTP conventions (API Contract v1.3 §1) — adopted in full (decision X-1/X-2)

| # | Decision | Why |
|---|---|---|
| H1 | **Error body** `{ "error": { type, code, message, param, request_id, doc_url } }` with the spec's type table; `402 → payment_required` is this service's billing extension; validation errors add `details: [{ param, message }]` with full snake_case paths (additive). `Content-Type: application/json`. Replaces RFC 9457. | X-2: the public contract outranks the template rule. |
| H2 | **`X-Request-Id` on every response**, assigned by middleware before guards run (caller value kept when sane, otherwise `req_<ulid>`), and echoed as `error.request_id`. | Guard failures used to report `requestId: "unknown"`. |
| H3 | **snake_case on the wire, camelCase inside:** a global interceptor converts request body/query keys to camelCase before validation and response keys to snake_case; the OpenAPI document is converted the same way. Routes whose payloads belong to someone else (Stripe, Ory web hooks) or are already in wire form (JWKS, the gateway exchange) are `@RawWire`. | 105 routes: converting at the boundary is uniform and cannot miss a field, where hand-renaming every DTO would. This **replaces the plan's "explicit DTO naming"** default. Free-form JSON (tenant settings) round-trips: its keys are snake_case on the wire too. |
| H4 | **Cursor pagination** `{ data, has_more, next_cursor, prev_cursor }` with `limit` (25, max 100), `starting_after`, `ending_before`; newest first; cursors are ULID ids. Offset pagination and its library are removed. The small currency catalog (keyed by ISO code) is returned as one page. | Spec §1 "All list endpoints use cursor-based pagination. No offset pagination." |
| H5 | **`Idempotency-Key` mandatory on POST/PATCH** for dashboard callers (optional for service callers, which dedupe on business keys); `idempotency_keys` table (DB Model §0.7), SHA-256 fingerprint of method + path + body, 24 h window, stored response replayed verbatim with `Idempotent-Replayed: true`, 409 `idempotency_key_collision` on reuse with a different body, 409 `idempotency_key_in_flight` + `Retry-After` while the first request runs; a failed request releases its key; hourly purge job. Replaces the per-route Redis `@Idempotent` decorator. Redis `IdempotencyService` stays for message-level dedup. | Spec §1 "Idempotency Strategy". |
| H6 | CORS no longer allows tenant headers (the tenant comes from the token); it allows `Idempotency-Key` and exposes `X-Request-Id`, `Retry-After`, `Idempotent-Replayed`. | Consistency with A8. |

### Events (DB Model v2 §0.6, Event Model v3 §2, Architecture v1.3 §3.2)

| # | Decision | Why |
|---|---|---|
| E1 | **Transactional `event_outbox`** (the §0.6 shape, `text`+CHECK status, UNIQUE(tenant, event_type, external_id), partial `idx_outbox_pending`). Services keep emitting domain events as before; a before-commit hook on the transaction wrapper writes the publishable ones **inside the same transaction**. Events emitted outside a transaction are recorded when emitted, and every publishing site in identity, API keys, invitations and tenant lifecycle now runs its change and its event in one transaction. | "An acknowledged event is eventually processed" without two-phase commit, and without every service calling an outbox by hand (the repo rule keeps side-effect calls out of services). |
| E2 | **One registry** (`src/common/events/outbox/published-events.ts`) decides what is public and maps each in-process event to its wire event(s): identity events per Event Model v2.1 §4.12; tenant, billing and usage events are this service's documented extensions. Wire names use snake_case actions (`tenant.deletion_scheduled`, not `tenant.deletion-scheduled`). Properties are flat and snake_case (§2.5). `external_id` is deterministic per domain fact. | Replaces the scattered SNS calls in `TenantListener` and `BroadcastEventListener`, which published three payload shapes to three topics. |
| E3 | **Canonical v3 envelope** in every row: `event_id`, `external_id`, `schema_version`, `event_type`, `event_class: domain`, `occurred_at`, `ingested_at`, `source {origin: platform_service, trust_level: high, producing_service: tenant-service}`, `tenant`, `actor` (operator or system), `object` (object types extended additively with `tenant`, `user`, `api_key`, `subscription`, `invitation`), `properties`, `metadata {correlation_id, request_id}`. | Event Model v3 §2. |
| E4 | **One topic, `tenant-events`** (AWS `tenant-events.fifo`) for identity and billing alike; message group = tenant, dedup id = `event_id`, message attribute `eventType` for subscription filters. The platform's transport wrapper is kept and carries the v3 envelope as its `payload`. | Architecture §3.2 lists only `tenant-events` for this service; keeping the shared transport wrapper means consumers built on the template keep working. |
| E5 | **Payment access tiers are `tenant.payment_restricted` / `tenant.payment_locked` / `tenant.payment_restored`**, distinct from the tenant's own `tenant.locked` / `tenant.unlocked`. | #25: `tenant.locked` meant two different things. |
| E6 | **Relay** (`EventOutboxRelayWorker`): every 2 s, oldest first, one job at a time; a tenant's later events wait after a failure so order holds; 10 attempts then `failed` (logged for an operator); published rows pruned after 7 days. | §0.6. Not run against a real topic — LocalStack has no `tenant-events.fifo` until the shared infrastructure creates it. |
| E7 | **tenant-service consumes nothing** (Architecture §2.1): the SQS usage consumer is removed; usage is metered only through the internal API, which dedupes on an `Idempotency-Key` business key (e.g. `referral.converted:{referral_id}`). | #28. |

### Data model and audit trail (DB Model v2 §3, API Contract v1.3 §8.3)

| # | Decision | Why |
|---|---|---|
| D1 | **One tenant status vocabulary:** `active`, `suspended`, `locked`, `closed` (text + CHECK). `deleted` rows migrated to `closed`; the unused `TenantStatusEnum` (with `pending` / `deletion_scheduled`) is gone. `locked` is kept as an **additive** value for the owner's self-service lock (§0.3 treats adding a value as non-breaking). Payment tiers stay in `payment_status`. | #31: two enums disagreed and the spec set has no self-lock state. |
| D2 | **Verification states per spec:** `unverified`, `pending`, `verified`, `rejected` (`pending_review` migrated to `pending`). | #31. |
| D3 | **`data_region`** (default `eu-central-1`, set at creation, not editable), **`retention_months`** (6–36, default 24, editable by the owner through `PATCH /v1/tenants`) and **`metadata`** added to `tenants`. **`plan` stays in `billings`** (the billing aggregate), not duplicated on `tenants`. `deleted_at` is kept instead of the spec's `archived_at`. | Residency and retention are spec columns (§3, API §8.3); a second copy of the plan would drift from Stripe. |
| D4 | **`users.status`** (`invited` / `active` / `disabled`). A removed operator becomes `disabled`, and `deleted_at` stays the timestamp (the spec's `disabled_at`) so the 15 existing `deleted_at: null` filters keep working. Pending invitees live in `invitations`, so `invited` is allowed but not written today. | #32. |
| D5 | **`audit_log` is written from the domain events the services already emit**, by a before-commit hook (same mechanism as the event outbox), so an action is audited exactly when it commits. Recorded: every published event with an operator or service principal, plus the non-published operator actions (settings, API key label, invitation resend, subdomain reserve/release). Not recorded: sign-ins, usage meters and trial clocks. The system is recorded as actor only for erasure (`tenant.deleted`, `user.anonymised`). `action` / target reuse the public event name and object; change sets split into `before` / `after`; the IP is stored only as a SHA-256 hash; the row id is the domain event id. No FK to `tenants`, so the trail outlives the tenant purge. | #34, DB Model v2 §0.5 and §3. Reusing the events means a new operator action is audited by emitting its event, with no second call to forget. |
| D6 | **`GET /v1/audit-log`** (human only, `audit:read`, i.e. Owner and Admin): cursor pagination plus `action`, `target_type`, `target_id`, `actor_user_id`, `occurred_after`, `occurred_before`. The IP hash is not returned. | API §8.3 says "dashboard only" and names no path. |
| D7 | **Removed the audit placeholders:** `AuditTrailListener` (SQS to an `audit-trail.fifo` no service consumes), `ApiKeyListener` (same queue), the `audit.*` duplicate emits, and the `email` / `audit` side-effect types, whose workers only logged "would send". The `effect_type` CHECK is now `sqs`, `sns`, `keto`. | They lost the data silently. `audit_log` replaces the audit path. Invitation emails are unaffected: `EmailNotificationListener` still sends them to notification-service (reviewed in the notification phase). |
| D8 | **A transaction keeps the whole request context** (IP, user agent, metadata), not only the log fields. | Found by the audit trail: actions inside a transaction had no IP. |

### Deletion, erasure, retention and verification (API Contract v1.3 §8.3, Product Spec v4 "DSR Propagation", DB Model v2 §3)

| # | Decision | Why |
|---|---|---|
| P1 | **Tenant deletion is a saga driven by `tenants.deletion_due_at`**, run by an hourly sweeper (`TenantDeletionSweeperWorker`) instead of a delayed BullMQ job. Scheduling sets the due date (1–90 days, default 30); cancelling clears it; the saga re-checks both before running, so a cancelled deletion never executes. | #36. A delayed job is lost with Redis and had no retry; the database is the source of truth. |
| P2 | **Saga order:** (1) Stripe subscription cancelled **immediately**, no refund or prorated invoice (`BillingService.closeForDeletion`, idempotent); (2) every member's Ory identity deleted (ends all sessions, 404 counts as done); (3) one transaction: API keys revoked, members anonymised in place, roles, invitations, notification preferences and tenant settings deleted, the tenant closed with name `Deleted tenant` and slug `deleted-{id}`, `tenant.deleted` written to the outbox. Every step is idempotent; a failure is retried by the next sweep, and the tenant stays open until the last step commits. | #36: before this, a "deleted" tenant only had its status flipped: it was **still billed**, its keys and sessions still worked, and its PII stayed. |
| P3 | **Kept after deletion:** the Stripe customer and its invoices (accounting retention), billing usage rows (no personal data), the `audit_log` (12 more months). The tenant logo file is not deleted (company branding, not personal data). | Legal retention; Product Spec v4 "Tension handled honestly". |
| P4 | **Data-subject erasure is an internal endpoint, not a queue consumer:** `POST /v1/internal/erasures/operators` (service capability `dsr.erase`), called by the compliance orchestrator's workflow activity with `{dsr_id, subject_email_hash | user_id}`. It returns this service's **receipt** (`completed` / `not_found` / `blocked`, erased ids, what is retained) and emits `user.anonymised`. | Product Spec v4 fans DSRs out from a Temporal orchestrator; Architecture §2.1 says tenant-service consumes nothing, and a synchronous activity gets the receipt without a reply queue. **Changes plan item "each service consumes `dsr.requested`" for this service only.** |
| P5 | **Operator erasure anonymises in place** (`member-erasure.ts`): email → `erased-{id}@erased.invalid` (undeliverable), `email_hash` of that placeholder, name null, `kratos_identity_id` → `erased:{id}`, status `disabled`; the row id stays so audit rows and other services' references stay valid. The Ory identity, roles, preferences and pending invitations to the address are deleted. The Owner of an open tenant is **`blocked`** (they transfer ownership or delete the tenant first). Participants (`/v1/erasure-requests`, `referrers:*`) are not held here. | API §8.3 "PII → hashed tokens"; a tenant is never left without an Owner. |
| P6 | **Retention sweep** (`RetentionSweeperWorker`, nightly 04:20): `audit_log` deleted 12 months after its tenant closed; invitations deleted 30 days after they can no longer be accepted (they hold the invitee's address); delivered side effects pruned after 7 days. `tenants.retention_months` is **published** (`tenant.created` with `data_region`, `tenant.updated` when it changes) for the services that hold event data to apply. | X-10 retention defaults; tenant-service holds no event data. |
| P7 | **`tenant_verifications`** backs `verification_status`: signup opens a `company` verification (`pending`) in the onboarding transaction and `tenant.verification_requested` carries its id. The workflow's `PATCH /v1/internal/tenants/{id}/verification` now reports `pending` / `in_review` / `verified` / `rejected` for a `verification_type` (default `company`), optionally with `verification_id`, `temporal_workflow_id` / `temporal_run_id`, `evidence` (document references only), `reviewed_by`, `reason`. Only `company` verifications move the tenant's status (`in_review` shows as `pending`). | #54, DB Model v2 §3 (R7: Temporal ids make a crashed verification resumable). |
| P8 | Removed the dead `features/tenant/stripe.service.ts` (never provided). | #47. |

### Billing — Stripe webhooks (T6a)

| # | Decision | Why |
|---|---|---|
| B1 | **`stripe_events` table** (Stripe event id as primary key) replaces the 24 h Redis dedup marker. Each event is recorded on arrival, then applied in a transaction that locks its row (`SELECT … FOR UPDATE`): state change, outbox events and the `processed` mark commit together. A redelivery or concurrent duplicate is acknowledged without effect. The payload is **not** stored (it can hold customer PII; Stripe keeps events 30 days). Processed/ignored rows are pruned after 90 days; `failed` rows are kept for an operator. | #39. Before: every handler caught and logged its own errors, so a failed event was still marked processed and **silently lost**; a Redis flush replayed old events. |
| B2 | **Out-of-order guard:** `billings.last_stripe_event_at` holds Stripe's `created` of the last applied state event; every state change is a compare-and-set on it, so an older event arriving late is recorded `ignored`. Tenant payment-status moves are compare-and-set too. | #39. Stripe does not guarantee delivery order. |
| B3 | **Failures propagate:** a handler error marks the row `failed` with the error and returns 5xx, so Stripe redelivers (up to 3 days). A bad signature is a 400 (not retried). Stripe reads (subscription plan, charge customer) happen **before** the transaction opens. Webhook routes answer **200**. | #39. |
| B4 | **Handled events:** `checkout.session.completed`, `invoice.paid` / `invoice.payment_succeeded`, `invoice.payment_failed`, **`invoice.payment_action_required`** (SCA → `payment.action_required` with the hosted invoice URL, for notification-service to email the Owner), **`customer.subscription.created/updated`** (status, plan, and cancel-at-period-end changes made in Stripe are mirrored), `customer.subscription.deleted`, **`charge.dispute.created/closed`** (→ `payment.dispute_opened` / `payment.dispute_closed`), **`charge.refunded`** (→ `payment.refunded`). `invoice_payment.paid` is ignored (it duplicates `invoice.paid`, and its object is not an invoice). | #38. |
| B5 | **Full Stripe status mapping:** `billings.status` now mirrors Stripe (`trialing`, `active`, `past_due`, `unpaid`, `incomplete`, `paused`, `canceled`; `incomplete_expired` → `canceled`; `none` = never subscribed). "Has a subscription" checks (trial expiry, plan limits, cancel) use the live set `trialing/active/past_due/unpaid`, so a past-due tenant keeps its plan while dunning runs. | #38: only `none/active/canceled` existed, so any other Stripe state was invisible. |
| B6 | **A failed payment never un-escalates:** `invoice.payment_failed` moves only an `active` tenant to `past_due`; a `restricted` or `locked` tenant stays where dunning put it. | Found while porting: the old handler set `past_due` from any state. |
| B7 | Webhook handling moved out of `BillingService` into `StripeWebhookService` (BillingService: 1217 → ~650 lines). Both `/api/webhook/stripe` and `/api/webhooks/stripe` stay (the Stripe dashboard may point at either). | SRP. |

### Billing — Stripe calls (T6b)

| # | Decision | Why |
|---|---|---|
| S1 | **Stripe idempotency keys on every write made for an API request:** `{operation}:{subject}:{the request's Idempotency-Key}` (checkout, upgrade, downgrade schedule, cancel, reactivate, setup intent, payment-method changes, portal). The tenant-deletion cancel uses `tenant-deletion:{subscription}`. Writes outside a request rely on the SDK's own retry keys (`maxNetworkRetries: 2`, 20 s timeout). One Stripe client is reused instead of one per call. | #43: a client retry could create a second checkout or a second proration invoice. The request key already exists (API v1.3 makes it mandatory on POST/PATCH), so it names the business intent exactly. |
| S2 | **Checkout reuses the tenant's Stripe customer** (`customer`), sets `client_reference_id` and `subscription_data.metadata.tenantId`. | Found while wiring tax: every checkout created a **new Stripe customer**, so a tenant could end up with several, and its payment methods and invoices split across them. |
| S3 | **Stripe Tax behind `STRIPE_AUTOMATIC_TAX`** (default `false`, recommended `true` in production once Stripe Tax is enabled on the account): `automatic_tax`, `tax_id_collection`, required billing address, `customer_update` for existing customers. | #44: EU VAT (Product Spec EU-first). Off by default so a Stripe account without Stripe Tax does not fail checkout. |
| S4 | **`GET /v1/billings/invoices` is cursor-paginated** with Stripe's own invoice-id cursors (`limit`, `starting_after`, `ending_before`; API v1.3 envelope). A tenant with no Stripe customer gets an empty page instead of a 400. | #44: it returned at most 100 invoices, silently. |
| S5 | **`POST /v1/billings/portal-session`** (`billing:write`, reachable while unpaid) returns a Stripe Customer Portal URL: cards, billing address, tax ids, invoice PDFs. New env `STRIPE_PORTAL_RETURN_URL`. | Plan item "Customer Portal"; the unpaid Owner needs a way to fix payment. |

### Billing — plans, limits, usage and dunning (T6c)

| # | Decision | Why |
|---|---|---|
| U1 | **Durable usage counters (`usage_counters`)** replace the Redis-only counters. Monthly metrics are keyed `YYYY-MM` (UTC), so a new month is a new row and **nothing is reset**; gauges (`campaigns`) use period `current`. Metering is **one atomic SQL statement** that adds only while under the limit (`INSERT … ON CONFLICT DO UPDATE … WHERE value + n <= limit`). Verified on real Postgres: 20 concurrent requests against a limit of 10 add exactly 10. | #42: losing Redis reset every limit; "check, then increment" let concurrent callers overshoot. |
| U2 | **`POST /internal/tenants/{id}/usage/increment` meters atomically against the plan** (402 `plan_limit_exceeded` when exhausted); `/decrement` releases, never below zero. | #41. |
| U3 | **Seats are counted, not metered:** operators plus invitations that can still be accepted. Enforced when inviting and when adding a user; a pending invitation already holds its seat, so accepting it is never refused. The API key limit (`api_keys` in the plan, if set) counts live keys. A plan that does not name a metric leaves it **unlimited**. | #41: no seat or key limit was enforced anywhere. |
| U4 | **Data-driven plans:** limits come from the `plans` catalog by plan name (a tenant's manual-invoicing plan first). The env price ids are now used only to talk to Stripe (checkout, price → plan). | #45: limits were resolved through env price ids, so a missing env var silently meant "no limits". |
| U5 | **Real downgrade validation:** a downgrade is refused (409 with `over_limit`) while usage (seats, gauges, this month's metered usage) exceeds the target plan. | #41: it was a placeholder that only logged. |
| U6 | **`GET /v1/internal/tenants/{id}/entitlements`** (`tenant_entitlements.read`): plan, subscription/payment/tenant status, trial end, data region, retention months, `limits` and `usage` (seats included). | Plan item; campaign, ingestion and reward services enforce against it. |
| U7 | **Usage thresholds (80 % / 100 %) and monthly summaries read the counters.** Thresholds fire once per metric and month (deduplicated in `billing_events`, and by `external_id` in the outbox); limits come from the plan catalog. | They read limits from a Redis key nothing ever wrote, so **no threshold ever fired**. |
| U8 | **Dunning is configurable** (`BILLING_DUNNING_RESTRICT_AFTER_DAYS`=7, `BILLING_DUNNING_LOCK_AFTER_DAYS`=14) and each step is a compare-and-set committed with its event, so a payment arriving mid-run is never overwritten. Suspended or self-locked tenants are escalated too. | #40. |
| U9 | Upgrade, cancellation, downgrade scheduling and trial expiry now commit their change and event in one transaction. | Plan item "wrap billing emits in transactions". |
| U10 | **Integration specs** (`*.integration.spec.ts`, `pnpm test:integration`, real Docker Postgres) are separate from the unit run. | X-5; starts T8. |

### Operations, admin routes, tests (T8)

| # | Decision | Why |
|---|---|---|
| O1 | **Worker pods get a probe-only HTTP server** (`WORKER_HEALTH_PORT`, default 3001): `GET /health/live`, `GET /health/ready` (Postgres + Redis); everything else 404. The worker serves no API. | #55: worker pods had no probe at all. |
| O2 | **Domain metrics** (`DomainMetrics`, pushed over OTLP like the rest): `tenant_outbox_published_total`, `tenant_outbox_failed_total`, `tenant_outbox_pending`, `tenant_outbox_pending_oldest_seconds`, `tenant_deletions_total{result}`, `billing_dunning_escalations_total{to}`, `usage_limit_rejections_total{metric}`, `dsr_operator_erasures_total{status}`; Stripe webhooks keep `billing_subscription_events_total{result}`. **Alert on:** oldest pending outbox row growing, any `tenant_outbox_failed_total`, any `tenant_deletions_total{result="failed"}`, Stripe `result=error`. | #56. |
| O3 | **Cached tenant access state** (`TenantStateCache`): the per-request tier check reads a 15 s Redis entry, evicted when a state change commits (suspend, lock, deletion, payment status); Redis down falls back to Postgres, never to allowing access. | #58: one Postgres read per request. |
| O4 | **Platform-admin lock/unlock:** `POST /v1/admin/tenants/{id}/lock` (`reason`, optional `lock_until`) and `/unlock`, platform admin only (live Keto). **Timed locks now expire:** a 5-minute sweeper unlocks tenants past `lock_until`. | #15; found: nothing ever queued the unlock job, so a `lock_until` was never honoured. |
| O5 | **Operator contacts for notification-service:** `GET /v1/internal/tenants/{id}/users/{userId}/contact` and `GET /v1/internal/tenants/{id}/contacts?role=OWNER` (`tenant_contacts.read`); live operators only. | Decision X-3. |
| O6 | **Custom domains behind `FEATURE_CUSTOM_DOMAINS`** (default off): setting or verifying a domain is a 409 while off, instead of accepting a domain that is never served (ACM/CloudFront provisioning does not exist). | #52. |
| O7 | **Messaging is producer-only:** SQS consumers were created for every configured queue (other services' queues included) with no handlers; tenant-service consumes nothing (Architecture §2.1). Removed with the consumer-side template code (DLQ consumer/replay, message processor, consumer decorators, Redis consumer dedupe, SES client). | Found during coverage work. |
| O8 | **Dead template code removed:** ClickHouse client/config (tenant-service owns no ClickHouse data; every pod opened a client), `common/mock`, `common/clients`, `common/rules-engines`, S3 key builder, unused exception classes, unused Redis/date/mapper/metrics/BullJobs helpers, the unused Redis subscriber connection, four never-emitted billing event classes. `@clickhouse/client` dependency removed. | Less surface; no code without a caller. |
| O9 | **Tests and gate:** `pnpm test:cov` enforces lines/statements ≥ 80 %, functions ≥ 75 %, branches ≥ 65 % (current 82 / 83 / 76 / 69; ratchet branches and functions up). Coverage counts logic files only (generated Prisma client, modules, DTOs, types, config and the dev-only `test-billing.controller.ts` are excluded). Integration specs (`pnpm test:integration`) run on the Docker infrastructure; BDD (`pnpm test:bdd`) covers HTTP flows incl. really signed Stripe webhooks. | Decision X-5. |
| O10 | Small fixes found while testing: the subscription view reported `payment_status: active` for any tenant without a trial; BullMQ connections now use `maxRetriesPerRequest: null` (was overridden with a warning on every boot); Stripe plan sync no longer warns for every absent limit key. | |
| O11 | **Probes on the unversioned paths.** `/health/live`, `/health/ready` and `/health` are version-neutral; with URI versioning they were only served at `/v1/health/*`, so the load balancer and Kubernetes probes the Helm chart points at `/health/*` got 404. | Found while aligning notification-service. |
| O12 | **Tenant communication profile for notification-service:** `GET /v1/internal/tenants/{id}/profile` (`tenant_contacts.read`) → `tenant_id, name, status, locale, app_url, reply_to`. The last three come from the tenant's `general` settings keys `locale` (BCP 47, canonicalised), `app_url` (https only) and `support_email`; null when unset or malformed. | Emails show the tenant's brand and link to the client's own app (API §7.1); events carry ids only. |
| O13 | **Request logs carry method, path and status only.** pino-http's default serializers logged every request header (bearer tokens, cookies, the Ory and Stripe web hook secrets), the client IP and full URLs with their query strings; the exception filter logged full URLs too. | Found while hardening notification-service logs (its M4). |

### Not done — deferred (shared phase or later), tenant-service

| Item | Why deferred / what is needed |
|---|---|
| Helm values for the new env vars (`STRIPE_AUTOMATIC_TAX`, `STRIPE_PORTAL_RETURN_URL`, `BILLING_DUNNING_*`, `WORKER_HEALTH_PORT`, `FEATURE_CUSTOM_DOMAINS`, `INTERNAL_JWT_*`, `GATEWAY_SHARED_SECRET`, `ORY_WEBHOOK_API_KEY`, `API_KEY_HASH_PEPPER`) and the worker Deployment's probes on `WORKER_HEALTH_PORT` | Shared deployment phase (Helm/CI). |
| Keto namespaces, Traefik forwardAuth, Kratos web hooks, SNS topic `tenant-events.fifo` | Shared infrastructure — see `my-docs/cross-service-requirements.md` §2. Until then the outbox relay cannot publish and Keto writes 404 locally. |
| Custom-domain provisioning (ACM certificate + CloudFront alias) | Infrastructure work; then set `FEATURE_CUSTOM_DOMAINS=true`. |
| Stripe catalog naming | Plan limits resolve by plan **name**: the Stripe product names must equal the plan names (`Free`, `Starter`, `Growth`, `Enterprise`) for synced plans to match `billings.plan`. |
| Stripe Tax | Enable Stripe Tax on the account, then `STRIPE_AUTOMATIC_TAX=true`. |
| Outbound headers | The HTTP client and outbound interceptor add `x-tenant-id` / `x-user-id` to every outbound call, external ones included. Restrict to internal hosts (review with the platform lead). |
| Client IP | `AlsAuthInterceptor` trusts the first `X-Forwarded-For` value; correct behind Traefik, spoofable if the service is ever reached directly. Configure the trusted proxy in the shared phase. |
| Unused config left in place | `aws.sqs.pollingEnabled` and consumer tuning, `temporalConfig`, `IIdempotentHandlerOptions` type — harmless, remove in a config clean-up. |
| Invitation email path | `EmailNotificationListener` still sends invitation emails to notification-service over SQS (raw token in the message). Reviewed in the notification phase (N2: recipient lookup). |
| Branch/function coverage | Gate floors 65 % / 75 %; raise as tests are added. |
| `tasks/lessons.md`, `tenant-implementation.md` | Updated at the end of the service pass. |

### Superseded rules (flagged for the lead, not rewritten)

- `CLAUDE.md` / `.claude/rules/security.md` say errors are "RFC 9457 ProblemDetail". Per decision X-2 the
  platform uses the API Contract v1.3 `{error:{type,code,message,param,request_id,doc_url}}` body (H1).
- `CLAUDE.md` "Consumes: …usage consumer on ANALYTICS_SVC_FIFO" and its Keto description are superseded by
  the model above.

### For the colleague's services

Full, step-by-step list: `D:\Projects\Work\REFERRAL\my-docs\cross-service-requirements.md`. In short:

- Accept the internal JWT (issuer `referralai-tenant-svc`, audience `referralai-internal`, JWKS at
  tenant-service `/.well-known/jwks.json`) and read `perms`; call Keto live only for the high-risk set.
- Check permissions as `{namespace}:{tenant_id}#{relation}` with subject `user:{user_id}`.
- Service-to-service calls into tenant-service use a Hydra client-credentials token whose client is granted
  the capability in Keto.

---

## Key decision — billing is kept (intentional)

The canonical responsibility contract (`referralai_responsibility_contract_v2.md`) and
`referralai_db_tables_per_service.md` scope this as an **Identity/Tenant** service and do **not** assign
client billing to it (payout processing → Reward & Payout service; Stripe/Paddle/Chargebee webhook relay
→ Referral Workflow service; client subscriptions/metering = not specified / later phase).

This service currently ships a full **Tenant + Stripe billing** implementation. Per the project
decision, **billing is retained** as an intentional, sanctioned extension of this "Tenant & Billing"
service. Nothing billing is removed. Phase 3 only realigns billing event names/payload casing where safe.

---

## Stale / superseded docs (flagged, not deleted)

- `docs/specs/microservices-architecture.md` — older 8-service spec that still contains the
  billing/payment events (`payment.failed`, `tenant.restricted`, etc.). **Superseded** by the canonical
  template `docs/`. Retained for history; do not treat as authoritative.
- `docs/architecture-alignment-notes-billing.md` — earlier alignment notes; **superseded** by this pass.
  Retained for history.

---

## Baseline health at start of pass (pre-existing, not caused by this pass)

Captured on the working branch before any code change:

- `pnpm build` → **green** (0 issues).
- `pnpm lint:check` → **red** (~23,978 `prettier/prettier` errors). Root cause: the repo has **no
  `.prettierrc`**, so eslint's `prettier/prettier` rule fell back to prettier defaults (double quotes,
  2-space) against a codebase written with single quotes / 4-space. **Fix:** adopt the template's
  prettier config in Phase 2 (`tabWidth: 4, singleQuote: true, printWidth: 150`) — this matches the
  existing style and clears the errors without reformatting code.
- `pnpm test` → **red** (3 suites / 15 tests). All three are **stale tests**, unrelated to spec scope:
  - `src/features/dns/subdomain.service.spec.ts` — test module missing the `DateService` provider the
    service now requires (DI resolution error).
  - `src/features/tenant/listeners/tenant.listener.spec.ts` — same missing `DateService` provider.
  - `src/features/tenant/guards/tenant-status.guard.spec.ts` — asserts old param-precedence behavior;
    the guard now intentionally resolves tenantId only from `TenantContextService` (tenant-isolation
    pattern). Test is outdated.

  **Decision:** restoring a green baseline is a prerequisite for the per-phase green gate, so these
  stale tests are repaired minimally (add the missing provider mocks; update the guard test to the
  context-only behavior). This is not a spec change — recorded here for traceability.

  **Resolved in Phase 2:**
  - Added the template `.prettierrc` (`tabWidth: 4, singleQuote: true, printWidth: 150,
    trailingComma: none`) + `.prettierrc.js` + `.prettierignore`. Per the decision, the codebase was
    normalized to this config with `pnpm lint --fix` (behavior-free, ~244 files) so lint matches the
    template/sibling services and the post-edit-lint hook won't churn future diffs.
  - Cleared the 6 real lint errors the prettier noise had hidden: `Function`-type → `object` in the two
    pagination decorators; `==`→`===`/`=== undefined` in `redis.service.ts`; merged a collapsible `if`
    in `payment-status-escalation.service.ts`.
  - Repaired the 3 stale suites (DateService provider mocks; context-only guard assertion; SNS
    positional-args + availability-precheck mocks). `pnpm test` → 64/64. `pnpm lint:check` → 0 errors
    (144 pre-existing warnings remain, non-failing). `pnpm build` → 0 issues.

## Prisma migration baseline — RESOLVED

The `src/prisma/migrations/` history was **stale**: the only migration (`20260219100415_init`) created just
3 tables (`currencies`, `side_effect_outbox`, `totos`), while the schema defines 17. The dev DB had been
synced via `prisma db push`, not migrations.

**Fix (decision: clean squash + reset):** the `20260219100415_init` migration was replaced with a single
**squashed baseline** generated from the current schema
(`prisma migrate diff --from-empty --to-schema src/prisma --script`) — all 17 tables incl.
`users`/`roles`/`user_roles`, the `EffectType` enum, 23 indexes, 13 FKs, and no stale `totos`. The dev DB
was rebuilt with `prisma migrate reset` (drops + re-applies the baseline + reseeds). `migrate status` →
"Database schema is up to date!". Fresh/CI/prod environments now get the full schema from one migration.

The service is pre-deployment (not yet on any dev server), so the reset's data loss was limited to
reproducible seed/mock data. The seed recreates the **tenant mock data** (test + default tenants) and
**billing mock data** (plans, billing rows), plus currencies and roles. Going forward use
`prisma migrate dev` for new changes (no longer `db push`).

## Tooling note — generated Prisma client excluded from lint/format

`src/prisma/generated/**` (git-ignored) was being linted; `prisma generate`/`db push` reverts its
formatting and trips `prettier/prettier`. Added it to `eslint.config.mjs` ignores and `.prettierignore`
so regeneration no longer breaks `pnpm lint:check`.

## Open contract items

- **api_key.* (Phase 3a — DONE):** published events now use the spec §4.12 wire contract on
  `USER_EVENTS_TOPIC`: `api_key.created` → `{ key_id, key_type, tenant_id, created_by }`,
  `api_key.revoked` → `{ key_id, revoked_by, revocation_reason }` (snake_case). Internal EventEmitter2
  events stay `api-key.*` (audit → AUDIT_TRAIL_FIFO, unchanged); the camelCase→snake_case mapping happens
  in `broadcast-event.listener.ts`. Added `key_type` (`secret`/`publishable`) to the `api_keys` table.
  **Open:** `revocation_reason` is emitted as `null` — the DELETE endpoint carries no reason body today;
  wire a reason field if a consumer needs it.
- **Identity tables + user.* (Phase 3b — DONE):**
  - Added spec tables `users` (keyed by `(tenant_id, kratos_identity_id)`, with denormalized `role`),
    `roles` (seeded: OWNER/ADMIN/OPERATOR/VIEWER → scopes), `user_roles`. Applied via Prisma migrations.
  - Published `user.registered` `{ user_id, tenant_id, role }` and `user.role_changed`
    `{ user_id, tenant_id, old_role, new_role }` to `USER_EVENTS_TOPIC` (snake_case), emitted directly by
    `UsersService` on membership add / role change.
  - **Consolidation (DONE — was a follow-up):** `team_members` has been **removed**; `users` (now with a
    denormalized `role` per spec) + `user_roles` are the single system of record. The membership surface
    moved from `/team-members` to `/users` (`/users`, `/users/me`, `/users/:id/roles`), the Keto resource
    `member` → `user`, and `UsersService` emits `user.registered`/`user.role_changed` directly (the
    `UserProjectionListener` was deleted). Migration `consolidate_team_members_into_users`.
  - **Ory delegation (intentional):** `oauth2_clients` and `sessions` are NOT created as local tables —
    Ory Hydra/Kratos are the system of record (the spec's own table notes say "managed via Ory"), and
    there is no API/event surface for them here (YAGNI).
  - **Role naming (DONE):** roles renamed to match the spec — Owner / Admin / **Operator** / Viewer
    (`MEMBER` → `OPERATOR`) across the enum, seed, and `users.role` default.
  - **User status (decision):** per the spec, `users` has **no status column** (team_members' status was
    dropped); member deactivation/suspension is deferred to Ory Kratos identity state.
  - **Spec gap (not built — out of scope):** `tenants.verification_status`
    (unverified→pending_review→verified→rejected, payout gate) from the responsibility contract is not
    present on the `tenants` table. Recorded for the Phase 4 audit / a separate task.
- **Internal/identity endpoints (Phase 3c — DONE):**
  - `GET /internal/validate-token` (`@Public`, version-neutral) resolves an API key
    (`x-api-key`/`x-tenant-api-key`) or an OAuth2 JWT (`Authorization: Bearer`) to
    `{ tenant_id, scopes, source, key_type, key_id, user_id }`
    (`TokenResolverService` reuses `ApiKeyService.validateKey`; JWT verification mirrors `JwtStrategy`
    JWKS config — no duplicated dependency).
  - `GET /v1/users/me` returns the current user's profile + roles/scopes from the user projection
    (canonical Sync API, system_architecture §"Sync APIs").
  - `PUT /v1/users/:id/roles` updates a user's role (`user_roles`) and emits `user.role_changed`
    (canonical Sync API, system_architecture §"Sync APIs"); last-admin protection enforced.
## Phase 4 — scope + cross-service contract audit

Cross-checked owned tables, published/consumed events, and endpoints against the canonical specs and the
read-only sibling repos (`referral-pulse-campaign-svc`, `referral-pulse-intelligence-svc`,
`referral-pulse-workflow-svc`).

### Published events — aligned ✅
- Billing/tenant events (`payment.failed`, `payment.restored`, `tenant.restricted`, `tenant.locked`,
  `tenant.restored`, `subscription.*`) match the siblings' shared `billing.events.ts` and the
  `BILLING_EVENTS_TOPIC` constant. Same topic constants (`USER_EVENTS_TOPIC`, `BILLING_EVENTS_TOPIC`)
  across all repos.
- `user.*` and `api_key.*` (Phase 3) publish to `USER_EVENTS_TOPIC` in spec snake_case; their consumers
  (Analytics/Dashboard/Webhooks) are not among the three available sibling repos, so no producer↔consumer
  conflict to reconcile here.

### Consumed event — hardened defensively ⚠️ (contract items for producer teams)
Our billing-extension consumer reads `referral.*` usage from `ANALYTICS_SVC_FIFO`, expecting
`{ metric, delta }`. Findings against the siblings:
1. **Shape mismatch:** the sibling `ReferralUsageEvent` carries `metric`/`delta` at the **event top
   level**, while our envelope nests the event under `payload`. → Hardened: the consumer now accepts
   `metric`/`delta` from `payload` **or** the envelope root (`billing.consumer.ts`).
2. **Producer in-dev:** the siblings' `analytics.listener` forwards generic `analytics.*` envelopes
   (eventType `analytics.event`, no `metric`/`delta`) — no producer yet emits `referral.* {metric,delta}`
   to us. Contract item for the referral/analytics producer team.
3. **Queue anomaly:** we consume from `ANALYTICS_SVC_FIFO` (the analytics service's own inbound queue).
   Per the architecture each service has one inbound queue named after itself; usage events should arrive
   on `tenant-svc.fifo`. Recommend a dedicated `referral.usage` producer → `tenant-svc.fifo`. Cross-team item.
(`metric`/`delta` are single words, so there is no snake_case/camelCase variance on these fields.)

### Out-of-scope code removed (sign-off-gated)
- **`CampaignEventsConsumer`** (`src/features/tenant/listeners/tenant-events.consumer.ts`) — **REMOVED**.
  It consumed `CAMPAIGN_SVC_FIFO` (the campaign service's own inbound queue) and was a dead stub (every
  handler log-only with `// TODO: ... Business logic`); the spec says the tenant service consumes nothing.
  It was registered nowhere and referenced only in its own file, so deletion was safe. The legitimate
  **producer** `campaign-service.listener.ts` (tenant → `CAMPAIGN_SVC_FIFO`) and the `@domains/campaign`
  types it uses are unaffected. Verified green (build 0, lint 0 errors, unit 64/64).

### Company verification (`tenants.verification_status`) — IMPLEMENTED + cross-team contract

Per `referralai_system_architecture_v1.md` §Company Verification, this service **owns**
`verification_status` (unverified→pending_review→verified→rejected) and the workflow service runs the
`account_verification` Temporal workflow. The workflow service has **not built that workflow yet**, so
this service defines its side of the contract (the workflow service must match it):

- **Field:** `tenants.verification_status` (default `unverified`), exposed on tenant responses.
- **Published (→ `tenant-events` SNS topic):**
  - `tenant.verification_requested` `{ tenant_id, tenant_name, requested_by }` — emitted at tenant
    creation (signup) for the workflow service to start `account_verification`.
  - `tenant.verification_status_changed` `{ tenant_id, previous_status, new_status, reason }` — emitted
    when the decision is applied.
- **Inbound decision callback (consumed):** `PATCH /v1/internal/tenants/:id/verification`
  (service-token auth) body `{ status, reason?, reviewedBy? }` — the workflow service calls this to apply
  its approve/reject decision; updates the field + emits `tenant.verification_status_changed`.
- **Not built here (per spec):** the Temporal `account_verification` workflow itself (owned by the
  workflow service) and payout-gating (owned by the Reward service). Contract item for those teams.
- Role naming `Operator` vs `MEMBER` — **RESOLVED** (renamed to OPERATOR).
- `team_members` ↔ `users`/`user_roles` consolidation — **RESOLVED** (team_members removed; users is the
  system of record; `/users` endpoints; Keto `user`).
- Prisma migration baseline — **RESOLVED** (squashed baseline + reset; see the migration-baseline section above).

## Error model standardized to the template/spec (was an old pattern)

Reviewing the template `src/` (via a throwaway overlay + `git diff`) showed our service used the **old**
error pattern. Adopted the canonical model per `referralai_api_contract` §error model:
- **Envelope:** `{ error: { code, message, param?, requestId, correlationId?, details? } }` (was RFC9457
  `{ type, title, status, detail, errorCode, instance, … }`).
- **`code`** is lowercase snake_case (`tenant_suspended`, `not_found`, …) — was UPPER `errorCode`.
- `BaseException` refactored to `(code: ErrorCode, message, status, param?, details?)` with `getCode()`;
  global filter rewritten to the new envelope (+ `X-Request-Id` header); adopted the template's
  validation/not-found/database/business/messaging exception classes.
- `ErrorCode` union is the template's standard set **extended** with this service's tenant/billing codes
  (`tenant_not_found`, `tenant_suspended`, `tenant_locked`, `tenant_context_required`, `payment_required`,
  `plan_limit_exceeded`, `file_*`).
- Updated all ~17 throw sites + the guard unit spec + the BDD error assertions to the new envelope.

The rest of the template `src/` review confirmed our shared utilities are **aligned or ahead** (older
baseline) — see below; only the error model was a genuine standard we were missing.

## Template structure mirror + shared-utility review

Mirrored the missing top-level structure from the template (additive, non-breaking):
`project-docs/` (architecture, dev-workflow, idempotency, event-architecture, onboarding + a `specs/`
copy with json schemas), `tasks/lessons.md`, `scripts/` (LocalStack setup), `Dockerfile`, `swcrc.json`,
`renovate.json`, `docker-compose.test.yaml`, `buildup.dev.sh`, `http-client.env.json`, `ingest.http`.

**Shared `src/` utilities — reviewed, NOT overwritten (finding).** The `src/common`/`config`/`types`
folder structure is identical to the template and the core utilities are functionally aligned **or ahead**
of it — the template `src/` is an **older baseline** we forked from, not a newer source. Evidence:
- `common/events/transaction-event-emitter.service.ts` — **identical**.
- `common/auth/jwt.strategy.ts` — **ours is ahead** (service-token/M2M handling the template lacks).
- `common/auth/permission.guard.ts` — **ours is ahead** (service-token bypass via `allowServiceTokens`).
- `common/messaging/sns-publisher.service.ts` — diff is **cosmetic only** (prettier object-expansion;
  both pass `prettier --check`).
- The largest diffs (`broadcast-event.listener`, `redis.service`) are **our own feature work**.

Conclusion: a blanket adoption of the template `src/` would **regress** this service. No newer template
utilities to adopt were found; if specific ones are known to have been updated upstream they can be
adopted individually. (Types/interfaces are centralized under `@app/types` here vs local files in the
template — a deliberate convention, kept.)

## Canonical docs location

`docs/` is the **source of truth** (read-only). It is newer than `project-docs/specs/`: e.g.
`docs/referralai_db_tables_per_service.md` places attribution in the Referral Workflow service (critical
path), while `project-docs/specs/` still has the older layout (attribution under Analytics). `api_contract`,
`responsibility_contract`, `failure_observability`, and `product_spec` are identical in both; only
`system_architecture`, `db_tables_per_service`, and `event_model` differ. **Treat `project-docs/specs/` as
a stale reference copy** (bundled with the template's `project-docs/`); align all work to `docs/`.

## Audit — spec(owned) ↔ code ↔ docs

### Owned tables (db_tables_per_service §1 Identity & Access) → code
| Spec table | In code | Notes |
|---|---|---|
| `tenants` | ✅ | richer than spec (billing/feature columns). Spec lists `plan` + `metadata` columns we don't have (plan lives in `billings`; no `metadata` jsonb). |
| `users` | ✅ | matches (id, tenant_id, email, name, role, kratos_identity_id, last_login_at). |
| `roles` | ✅ | matches. |
| `user_roles` | ✅ | matches. |
| `api_keys` | ✅ | **field divergences** — see below. |
| `oauth2_clients` | ⚠️ Ory | delegated to Ory Hydra (no local table) — intentional. |
| `sessions` | ⚠️ Ory | delegated to Ory Kratos (no local table) — intentional. |

### Identity events (event_model §4.12) → code
| Spec event | In code |
|---|---|
| `user.registered` `{user_id,tenant_id,role}` | ✅ |
| `user.logged_in` `{user_id,auth_method}` | ✅ emitted from the Ory after-login webhook (`POST /webhook/ory/login`) → USER_EVENTS_TOPIC |
| `user.role_changed` (system_architecture §85) | ✅ |
| `api_key.created` `{key_id,key_type,tenant_id,created_by}` | ✅ |
| `api_key.revoked` `{key_id,revoked_by,revocation_reason}` | ✅ |

### Endpoints (api_contract §2.2 + system_architecture) → code
| Spec | In code |
|---|---|
| `POST /v1/api-keys`, `GET /v1/api-keys`, `DELETE /v1/api-keys/{id}` (revoke), rotate (system_arch §80) | ✅ incl. `POST /v1/api-keys/:id/rotate`; plus `GET/:id`, `PUT/:id` for label/scopes |
| `GET /v1/users/me`, `PUT /v1/users/{id}/roles` (system_arch Sync APIs) | ✅ |
| `GET /internal/validate-token` (system_arch) | ✅ |

### DIVERGENCES / DECISIONS (spec-owned items where code differs)
1. **API key prefix — FIXED:** `generateSecureApiKey(keyType)` now emits `rai_pub_` (publishable) /
   `rai_live_` (secret) per api_contract §2.2 (was always `sk_live_`). The gateway routes on this prefix.
2. **api_keys — FIXED, now strictly per db_tables §api_keys:** `name`→`label`; `status` enum replaced
   with `revoked_at` (null = active); status endpoint/event/enum removed (revoke = `DELETE
   /v1/api-keys/:id` sets `revoked_at`, api_contract §2.2 "immediate, irreversible"); `key_hash` is now
   **bcrypt** (cost 12) and `key_prefix` is the **last 4 chars** (display identifier + validation lookup
   narrowing). Because bcrypt is salted, `validateKey` narrows candidates by the non-unique last-4
   prefix and `bcrypt.compare`s each.

   *Follow-up cleanup — DONE:* removed the unused, stale duplicate API-key helpers
   (`generateSecureApiKey`/`hashApiKey`/`compareApiKeys`/`extractApiKeyPrefix`, plus the `sk_live_`
   constant and the now-unused `crypto`/`bcryptjs` imports) from
   `src/common/redis/redis-key.builder.ts`. Those had no callers; api-key hashing lives solely in
   `ApiKeyService`.
3. **`user.role_changed`:** **canonical** — listed in system_architecture §85 ("Publishes Events") for the
   Tenant Service (absent from event_model §4.12's table, but spec-mandated). Emitted on role update.
4. **`/v1/users/me`, `/v1/users/:id/roles`:** canonical — system_architecture lists both under the
   Tenant Service's §"Sync APIs" (absent from api_contract v1.2's table, but spec-mandated). Implemented
   exactly. Only the extra user CRUD (`POST/GET /v1/users`, `GET/DELETE /v1/users/:id`) is a
   dashboard-management extension.
5. **Extra events/tables (features/billing extension):** tenant.* lifecycle, subscription.*, payment.*,
   verification.*, invitations, tenant_settings, dns, files — beyond the minimal identity spec; billing
   is the sanctioned extension, the rest are tenant-management features.

All strict identity-spec items (tables, §4.12 events, api-key/users/validate-token endpoints) are
present and aligned; the once-open gaps (#1 api-key prefix, #2 api_keys fields + bcrypt/last-4) are
resolved. Remaining items are sanctioned extensions (#3 `user.role_changed`, user CRUD, #5 billing).

## Verification

| Gate | Result |
|---|---|
| `pnpm build` | ✅ 0 issues |
| `pnpm lint:check` | ✅ 0 errors (146 pre-existing warnings, non-failing) |
| `pnpm test` (unit) | ✅ 64/64 |
| `pnpm test:bdd` (Cucumber) | ✅ 17/17 (82 steps) |

### BDD — 7 pre-existing failures fixed (follow-up pass)

The BDD suite originally had 7 failures (verified pre-existing — same failures on the committed Phase 2
baseline with all later changes stashed). All now pass:

- **Tenant-status guard not enforced (3 scenarios + the 404 case).** `TenantStatusGuard` read the tenant
  id from the ALS context, which is populated by `AlsAuthInterceptor` — but **guards run before
  interceptors**, so it always saw `undefined` and allowed everything (a latent no-op everywhere it was
  used). Fixed the guard to resolve the tenant id from the request at guard time (`req.user.tenantId`
  set by the global `JwtAuthGuard`, then `x-tenant-id` header, then `req.tenantId`, then ALS as
  fallback), and applied `@UseGuards(TenantStatusGuard)` to `BillingController`. Now suspended → 403
  `TENANT_SUSPENDED`, locked → 403 `TENANT_LOCKED`, missing tenant → 404 `TENANT_NOT_FOUND`.
  (`TenantLockGuard` had the same latent ALS-timing issue and was fixed the same way.)
- **JWKS rate-limit (`401 "Too many requests to the JWKS endpoint"`).** The test bootstrap forced
  `AUTH_CACHE_ENABLED=false`, so every token re-fetched the JWKS and jwks-rsa's 10-fetches/min limit
  tripped mid-suite. Enabled the JWKS cache in the bootstrap (key is cached; signature/exp/aud are still
  checked per token).
- **Subscription `status` field.** The scenario asserted a `status` field; the response uses
  `subscriptionStatus`. Aligned the feature to the real (intentional) field.
- **Stripe checkout timeout + upgrade-preview.** The Stripe SDK's default transport (fetch/undici) is not
  interceptable by nock, so checkout hung on the real (unreachable) API. Override `StripeService` with a
  fake at the test boundary (`test/bdd/support/stripe.fake.ts`) — Stripe is a genuine external dependency.
  Added an `@needs-active-subscription` fixture so the upgrade-preview scenario has a subscription to
  preview. Also blocked `api.stripe.com` in `nock.setup` so any accidental real Stripe call fails fast.

### Intentional deviations (traceability)
- Billing subsystem retained (per decision) though the responsibility contract scopes it out.
- `oauth2_clients`/`sessions` delegated to Ory (no local tables).
- `users` (+denormalized `role`) / `user_roles` are the system of record for membership; `team_members`
  was removed (consolidated per spec). Role assignment is the canonical `PUT /v1/users/:id/roles`.

### Out-of-scope template boilerplate (cleanup)
The events module shipped cross-service **producer** listeners copied from the service template that
pushed to *other* services' queues (most bound to placeholder `toto.*` / catch-all `**` events) — work
the identity/tenant service should not own:
- **Removed:** `ReferralServiceListener`, `RewardServiceListener`, `TrackingServiceListener`,
  `CampaignServiceListener`, `AnalyticsListener` (was never registered in `EventsModule` — dead; also
  carried a stray card-number-shaped comment), plus the unused `user.created/updated/deleted` domain
  events and the now-orphaned `@domains/toto`, `@domains/referral`, `@domains/campaign`.
- **Kept (in-scope):** `TenantServiceListener` (billing/quota — revisit with the billing decision);
  `BroadcastEventListener` (SNS fan-out), `AuditTrailListener`, `EmailNotificationListener`.
- **Still flagged:** the `REWARD_SVC_FIFO` / `CAMPAIGN_SVC_FIFO` queue-name constants in `app.type.ts`
  are now unused (left as a platform queue registry; remove if undesired).

### Tenant feature audit
The canonical docs mandate only the `tenants` table + isolation — there is **no `/v1/tenants`
management API** in the contract, so the entire tenant controller surface (provision, profile, custom
domain, ownership transfer, deletion scheduling, lock/suspend) is an **extension**, much of it
billing-driven. Table + `verification_status` + isolation all conform to db_tables §1.
- **FIXED (security):** `AdminTenantController` (`POST /v1/admin/tenants/:id/suspend|unsuspend`) was only
  behind the global `JwtAuthGuard` with no authorization (`PermissionGuard` is a no-op without
  `@RequirePermission`) — any authenticated user could suspend any tenant by id. Now guarded with
  `@RequirePermission({ namespace: TENANT, relation: UPDATE, allowServiceTokens: true })` (class-level),
  restricting it to service tokens / principals holding the Keto `tenant:update` relation.
- **Deferred — internal endpoint versioning:** `PATCH /v1/internal/tenants/:id/verification` and billing's
  `GET /v1/internal/tenants/:id/status` are `/v1/…`; spec writes internal endpoints unversioned (as done
  for `/internal/validate-token`). Both are cross-service contracts (workflow svc; other svcs) — align in
  one coordinated pass once contracts + the billing decision are settled.
- **Flagged — duplicate `StripeService`:** `features/tenant/stripe.service.ts` duplicates
  `features/billing/stripe.service.ts` and appears unused; fold into the billing keep/move decision.

### Invitation feature (sanctioned extension)
Team/member invitations are **not in the canonical docs** — the only "invitation" there is the *referral
email invitation* (a referee-tracking concept owned by the referral/notification services). Built here as
a deliberate dashboard team-management extension (same category as the `/users` CRUD), to spec'd identity
primitives:
- **Admin (tenant-scoped, Keto `tenant:user` perms):** `POST/GET /v1/invitations`, `POST
  /v1/invitations/:id/resend`, `DELETE /v1/invitations/:id`. `create`/`resend` emit
  `invitation.created`/`invitation.resent` → `EmailNotificationListener` (resend issues a fresh token).
- **Public:** `GET /v1/invitations/public/:token` (validate); `POST /v1/invitations/public/:token/accept`
  requires the invitee's **own Ory-authenticated JWT** (email must match the invite) — Ory Kratos owns
  credential creation; accept calls `UsersService.provisionMember` → creates `users`/`user_roles` and
  emits `user.registered`. Statuses: PENDING→ACCEPTED/REVOKED/EXPIRED (expiry is lazy, 7-day TTL).

#### First-authentication for a brand-new invitee (the onboarding gap — fixed)
A never-seen invitee has no tenant membership, so the OAuth2 token they obtain after registering carries
no tenant claim. Previously `JwtStrategy` hard-rejected any human token without a tenant, so accept was
unreachable for exactly the people it targets. **Upstream flow (Ory, unchanged):** the accept page sends an
unauthenticated invitee through Ory's self-service registration/login for the invited email; Ory creates
and verifies the credential and returns them authenticated. **Backend fix (this service):** authentication
is now **tenant-optional on opt-in routes only** — `JwtStrategy.buildHumanUser` no longer throws on a
missing tenant (the token is still fully validated: signature/issuer/audience/expiry), and `JwtAuthGuard`
re-enforces "tenant required" for **every** human route *except* those marked `@AllowNoTenant()`. Only the
accept endpoint carries `@AllowNoTenant()`; it derives identity (`sub`/email) from the token and the tenant
from the invitation. Service tokens remain tenant-optional as before. No new Ory surface (no
`createIdentity`); least-privilege, single opt-in route.
- **Not built (intentional):** no Kratos `createIdentity` provisioning (Ory owns first-auth, per above);
  no `invitation.accepted/revoked` broadcast (no consumer); no expiry cron (lazy). Tests deferred per the
  "tests later" preference — follow-up.

### dns / files / tenant-setting audit (extensions — none in db_tables §1)
- **dns:** subdomain + DNS-verification services backing the tenant custom-domain extension; clean.
  `domain-provisioning.service.ts` is now an **explicit, honest placeholder**: `provisionDomain` logs a
  single warning (was logging fake "Requesting ACM Certificate…" steps), and the dead
  `checkProvisioningStatus`/`deprovisionDomain` methods + orphaned `ProvisioningStatus` enum were removed.
  Real ACM cert + CloudFront alias provisioning is **deliberately deferred** — it needs new AWS SDK
  clients, isn't testable on the local stack, and is an infra/IaC concern for a non-spec extension. A
  verified custom domain is recorded but **not served** until that lands.
- **files — FIXED:** added `File.tenantId` (+ index, migration) and tenant-scoped the by-id endpoints
  (`GET/PUT/DELETE /v1/files/:id` now filter by current tenant, defensively requiring tenant context) —
  closes the IDOR where any authenticated user could read/overwrite/delete any file by id. Added multer
  size (10 MB) + MIME-type allowlist; dropped redundant per-method `@UseGuards(AuthGuard('jwt'))`.
  **Storage wired (follow-up DONE):** uploads now go through `S3Service.upload` (memory storage →
  `file.buffer` → S3, keyed `tenants/{tenantId}/{uuid}.{ext}`); `path` stores the returned location.
  Tenant-creation logo upload runs under the new tenant's context (`runWithContext({ tenantId })`) since
  the row doesn't exist yet but its id is known. Verified by build/lint/unit; BDD has no file scenarios
  and requires the Docker infra (Postgres/Redis/LocalStack) to be up.
- **tenant-setting — FIXED:** `TenantSetting` is a per-tenant singleton, but the controller exposed full
  CRUD (paginated `findAll`, `GET/DELETE /:id`). Trimmed to `GET /current` + `PUT` (upsert); removed the
  list/by-id/delete endpoints, the unused service methods, `tenant-setting.pagination.ts`, the orphaned
  `CreateTenantSettingDto`/`TenantSettingDeletedEvent`, and the misleading required `x-tenant-id` header.
  `user-notification-preference` (`/v1/me/notification-preferences`) was already correct.

## Billing — extraction-readiness scope (read-only pass, for the keep-or-move decision)

Billing is a large but **mostly self-contained** subsystem: 4 tables (`plans`, `billings`,
`billing_events`, `tenant_usages`), ~28 feature + 24 domain files, 7 controllers (~50 routes), Stripe
integration, usage metering, trial lifecycle, and payment-status escalation. Its **guards/decorators
(`PaymentRequiredGuard`, `BillingGuard`, `UsageCheck`) are used nowhere outside billing**, and no other
feature imports billing services — so the outward surface is small.

**Coupling to sever when moving billing to its own service/repo (in priority order):**
1. **Direct tenant-table writes (hardest).** `payment-status-escalation.service` does
   `prisma.tenant.update(...)` to set `payment_status` / `payment_status_changed_at` and drive
   suspend/lock. Cross-domain write into tenant rows. → Replace with events: billing emits
   `payment.failed` / `tenant.restricted` / `tenant.locked` and the tenant service updates its own table.
2. **`billing.module` imports `TenantModule`.** Billing depends on the tenant feature directly. → Decouple
   via events / a thin internal HTTP call.
3. **Stripe webhook lives in the (mixed) `webhook` feature.** `POST /webhook/stripe` →
   `BillingService.handleStripeWebhook`, but the same controller also has `POST /webhook/ory/signup`
   (identity — stays). → The Stripe webhook moves with billing (canonical spec routes Stripe-webhook relay
   to the Referral-Workflow service); the Ory signup webhook stays here.
4. **`billing.*` SNS broadcasts** in `broadcast-event.listener` (`@domains/billing` event types) move with
   billing. `TenantServiceListener` (quota/usage) is billing-adjacent and moves too.
5. **Shared DB.** The 4 billing tables sit in `tenant_db`; the tenant table carries billing-driven columns
   (`payment_status`, `trial_*`, payment-driven `lock_*`). On split → `billing_db`, and tenant
   `payment_status` becomes an event-synced projection.
6. **Cleanup already flagged:** `features/tenant/stripe.service.ts` is a dead duplicate of the billing
   `StripeService` (uses `BillingPlanEnum`) — remove during/after extraction.

**Independent flag (regardless of the decision):** `test-billing.controller.ts` exposes a `/test/*`
surface (~30 routes: run jobs, Stripe-connection test, manual plan seeding, usage increment/decrement,
read billing entity/events). This is dev scaffolding and should be excluded from production builds or
removed — it is currently registered in `BillingModule`.

**Verdict:** moderate effort, well-bounded. The blast radius is essentially items 1–2 (turn the two direct
tenant writes/imports into events) plus moving the Stripe webhook + billing broadcasts + DB. Nothing in
the identity/tenant core depends on billing internals, so the split is clean once those tendrils are
event-driven. No code changed in this pass.

---

# V5 spec alignment (2026-10-14)

The spec suite was rewritten. The **only** source of truth is now
`D:\Projects\Work\REFERRAL\referral-scope-ahmed\referral spec\referral spec` — the ten v5 documents
plus eleven JSON Schemas. The copies in this repo's `spec/` are superseded and are to be replaced,
but not in this pass: alignment comes first.

Phases are `T1`…`T5`, one cherry-pickable commit each.

## V5.1 What changed for this service

Two kinds of change. The first is field- and value-level drift against documents that mostly kept
their shape. The second is new: **Architecture v5 §2.1 assigns tenant-service four responsibilities
it did not have**, and three of them have nowhere to live (§V5.4).

### Auth and roles — API Contract v5 §2

This is the substance of the alignment, because `permission-catalog.ts` is the single definition the
tuple writer, the `perms` resolver and the guards all read from, so every gap in it is a gap in
authorization platform-wide.

| # | v5 says | code has |
|---|---|---|
| P1 | `rewards` relations include `adjust` and `resend_email` | neither — so a Support Agent cannot be granted either |
| P2 | `referrers` relations include `note` | missing |
| P3 | four standard roles: `owner`, `operator`, `viewer`, **`support`** | `OWNER`, **`ADMIN`**, `OPERATOR`, `VIEWER` — `support` absent, `admin` is not a v5 role |
| P4 | `operator` also gets `campaigns:complete`, `referrals:read`, `referrals:reject` | all three missing |
| P5 | `viewer` also gets `programs:read`, `variants:read` | both missing |
| P6 | `support` gets `referrers:read/note`, `referrals:read`, `rewards:read/adjust/resend_email`, `analytics:read`, and its writes are "live-Keto, reason-mandatory, audit-logged" | the whole role |
| P7 | the live-check set includes `rewards:adjust` (and §2 marks support's `resend_email` / `note` live-checked too) | missing |

Already correct, checked rather than assumed: the other nine namespaces and their relations; the
hybrid model (`perms` snapshot in a short JWT, live Keto for money/keys/object-scoped); tenant
isolation returning 404 rather than 403; `service:{client_id}` subjects for machine callers; and
tenant-scoped role objects — the spec's own `role:operator#member` example is *not* tenant-scoped,
which would grant across tenants, and `keto-tuples.ts` already departs from it deliberately.

### Data model — DB Model v5 §3

| # | v5 says | code has |
|---|---|---|
| D1 | `tenants.plan CHECK in ('free','starter','growth','scale','enterprise')` | the column is `billing.plan`, a free `varchar(50)` with no CHECK, default `'Free'`; `BillingPlanEnum` is title-case with four values — **`scale` missing**. v5's DB Model defines no billing tables at all, so `tenants` is the only place it could have put `plan` |
| D2 | `roles` has `tenant_id` (null for the four standard roles) and `keto_relations jsonb` | no `tenant_id` (so no custom per-tenant roles) and the column is `scopes` |
| D3 | `api_keys.keto_scope_note text` | missing |
| D4 | `idx_api_keys_tenant_active (tenant_id) WHERE revoked_at IS NULL` | a plain `(tenant_id, revoked_at)` index |
| D5 | `oauth2_clients` table | missing |
| D6 | `sessions` table | missing |
| ~~D7~~ | ~~verification status values~~ | **withdrawn — already correct, see below** |

**D7 withdrawn.** Read from the enum rather than the schema the first time. The migration
`tenants_verification_status_check` is already `('unverified','pending','verified','rejected')` —
exactly v5 §3. `DomainVerificationStatusEnum`, whose fourth value is `failed`, governs
`domain_verification_status`, a different column that v5 does not specify at all.

Two things worth recording while the constraints were open:

- `tenants_status_check` is `('active','suspended','locked','closed')` where v5 §3 says
  `('active','suspended','closed')`. The extra `locked` is real — the tenant carries
  `locked_at`/`lock_until`/`lock_reason` and the billing lifecycle drives it. An extension beyond
  the spec rather than a contradiction, but v5's set is narrower and someone should know.
- `tenant_verifications_status_check` is `('pending','in_review','verified','rejected')`, matching
  DB Model §3 exactly. That settles spec defect 2 below: the code follows the DB Model, and
  Architecture §2.1's `pending_review` is the outlier.

### Already aligned, no work needed

`users`, `user_roles`, `audit_log`, `tenant_verifications`, `event_outbox`, `idempotency_keys` match
§3 field for field. `tenants` carries `data_region`, `retention_months` and `metadata` as specified.
`api_keys.key_prefix` is `char(4)` and the full key is returned once — and the DB Model's own
`char(4)` is what settles the length question against Event Model §2.2.

## V5.2 Decisions

**T-1 — `admin` becomes a custom role, not a deleted one.** v5 names four standard roles and
`admin` is not among them, but removing a role that may be assigned to live users would orphan them
mid-session. v5 resolves this itself: `roles.name CHECK in ('owner','operator','viewer','support')
**or custom**`, with `tenant_id` null only for the standard four. So `admin` stays, reclassified as a
custom role with its existing grants, and `support` is added as the fourth standard role. Nobody is
locked out, and the standard set matches the spec.
*Rejected:* delete `ADMIN` (breaks live assignments for no gain); leave it as a fifth standard role
(the spec's standard set is closed, and `roles.name`'s CHECK would then disagree with it).

**T-2 — the `referrers` namespace name is correct as-is; the spec's §2 table is the typo.** API
Contract §2's namespace table calls it `participants`, while its own role mapping, actor table and
tuple examples all say `referrers` — 31 occurrences of `referrers:` across the v5 suite against zero
of `participants:`. A Keto namespace is an exact string, so this is not a synonym question: writing
`participants:note` would produce a tuple nothing checks. No code change; raised as a spec defect.

## V5.3 Phases

| # | Phase | Covers |
|---|---|---|
| T1 | permission catalog and roles | P1–P7 |
| T2 | plan / verification value sets | D1, D7 |
| T3 | `keto_relations` — the projection fix (the other three §3 items left out, §V5.9) | D2 |
| T4 | ~~`oauth2_clients` and `sessions` tables~~ | **not building — decision T-4, §V5.8** |
| T5 | the four new v5 responsibilities | §V5.10 — new scope, not drift |

## V5.4 The new responsibilities have nowhere to live

Architecture v5 §2.1 gives tenant-service four responsibilities it did not have in v3:

1. **consent registry**
2. **data-subject requests — `POST /v1/dsr` and the DSR fan-out Temporal workflow**
3. **audit sink** (Product Spec R-CPL-01)
4. **provider connection config and secrets** — billing, payout, CRM, webhook signing secrets and
   the tracking-token key, "exposed to Event Ingestion through a cache"

DB Model v5 §3 provides tables for exactly one of them. Its table list is nine — `tenants`, `users`,
`roles`, `user_roles`, `api_keys`, `oauth2_clients`, `sessions`, `tenant_verifications`,
`audit_log` — and its own summary matrix (§13) repeats that nine. `audit_log` already existed, so
the audit sink is covered. There is **no table for the consent registry, none for data-subject
requests, and none for provider connections or their secrets.**

That last one is the sharpest: Architecture §2.1 and the §2.4 addendum both say Event Ingestion reads
provider connection secrets from a tenant-service cache, and the ingestion service's own revision
note says the inbound receivers verify "the provider's signature scheme ... against the connection
secret cached from tenant-service". So another service's documented ingress path depends on a store
this service is told to own and given no schema for.

This is not something to design unilaterally — it is secret material for a money path, with
residency and retention consequences, and the DSR fan-out is a cross-service workflow contract. T5
stays open pending a DB Model section for the three. The documents are mid-revision and say so: the
architecture's own header lists "Still to author" items and notes that the §11.2/§12/§13 drawings
"still show the old provider lane — to redraw".

## V5.5 Spec defects found — for the clean-up round

1. **The §2 namespace table says `participants`; everything else says `referrers`.** Decision T-2.
   A namespace is an exact string, so one of them produces tuples nothing checks.
2. **Company verification has two different state sets.** Architecture §2.1 says the
   `account_verification` workflow runs `unverified → pending_review → verified → rejected`; DB Model
   §3 types `tenant_verifications.status` as `('pending','in_review','verified','rejected')`.
   `pending_review` vs `in_review`, and the DB has no `unverified` state while `tenants`
   `verification_status` does.
3. **API keys cannot be both bcrypt-hashed and looked up by hash.** API Contract §2 says "API keys
   are bcrypt-hashed" and DB Model §3 says `key_hash text not null (bcrypt/argon2 of full key)` with
   `Unique: (key_hash)`. bcrypt and argon2 are salted, so the digest is not reproducible from the
   presented key — a unique index on it can never be probed, and validation would have to scan every
   row. This service uses HMAC-SHA256 with a pepper, which is deterministic, indexed and still
   non-reversible. The spec should say keyed-hash, not bcrypt.
4. **Four responsibilities assigned with tables for one.** §V5.4.
5. **Architecture §2.3 still lists `conversion.recorded` under segmentation's Publishes**, while the
   same document's revision header says "segmentation-service no longer emits a translated
   conversion.recorded" and Event Model §4.12 says the translation does not happen. Not this
   service's, but it is a contradiction inside one document.

## V5.6 Progress

| Phase | Status |
|---|---|
| T1 permission catalog and roles | done — `feat(authz): align the permission catalog and roles to API Contract v5` |
| T2 plan tier | done — `feat(billing): add the Scale plan tier v5 defines` |
| T3 `keto_relations` — the projection fix | done, scoped down — `fix(authz): derive the role projection from ROLE_GRANTS…` (§V5.9) |
| T4 `oauth2_clients` and `sessions` tables | **not building — decision T-4** (§V5.8) |
| T5 the four new responsibilities | **new scope, not drift** — proposed shapes awaiting approval (§V5.10) |

Verified after T2: 51 suites / 495 unit tests green, 28 typecheck errors — the same 28 that were
there before this pass, none in a file it touched — and no new lint errors.

## V5.7 T3 is a migration, so it stops here for approval

Three of the four items need DDL, and this repo treats migrations as an approval gate rather than a
detail. What is pending, and why each matters:

1. **`roles.keto_relations`, and the fact that `roles.scopes` currently disagrees with the
   authoritative catalog.** This is more than a rename. DB Model §3 wants
   `keto_relations jsonb` holding the relation set a role grants, e.g.
   `["campaigns:write","rewards:approve"]`. The column today is `scopes`, and the seeded values are
   wildcards from an older vocabulary — `['tenant:*']`, `['users:*','api_keys:*','billing:read']` —
   which are not Keto relations and do not match `ROLE_GRANTS` in `permission-catalog.ts`. §3 is
   explicit that `roles`/`user_roles` are "a projection for dashboard display and bulk assignment,
   not the authoritative permission store", so the projection is simply stale: a dashboard rendering
   a role's permissions from this table shows something the guards do not enforce.
   *Recommended:* rename to `keto_relations` and seed it **from `ROLE_GRANTS`** rather than by hand,
   so the projection is derived from the single source of truth and cannot drift again — the same
   shape as the ingestion property manifest.
2. **`roles.tenant_id`**, null for the four standard roles and set for custom ones. Decision T-1
   keeps `ADMIN` as a custom role, and v5 scopes custom roles to a tenant; without the column
   `ADMIN` is a global row, which is the one part of T-1 the schema cannot yet express.
3. **`api_keys.keto_scope_note text`** — missing. A free-text note on what a key is scoped to.
4. **`idx_api_keys_tenant_active (tenant_id) WHERE revoked_at IS NULL`** — the index today is a
   plain `(tenant_id, revoked_at)`. The partial form is what §3 specifies, and it is the better
   index for the only query that uses it (list a tenant's live keys).

Item 4 alone is a safe, non-breaking index swap. Items 1–3 are additive DDL plus a data backfill for
`keto_relations`.

## V5.8 Decision T-4 — `oauth2_clients` and `sessions` are not being built

DB Model v5 §3 lists both, so this is a deliberate departure rather than an oversight.

Both are described in the spec as **mirrors of Ory**, not as systems of record: `sessions` is
"Active dashboard session index (Ory Kratos authoritative; this is a fast local lookup + revocation
list)" and `oauth2_clients` "Mirrors/augments Ory Hydra". This service delegates both entirely to
Ory today — `kratos.service.ts` for sessions, Hydra via the credential resolver for clients — and
nothing reads a local copy.

Building them now would add two tables with no reader, which KISS and YAGNI both rule out, and it
would be worse than merely unnecessary: a mirror that nothing keeps current goes stale, and a stale
session index used as a revocation list is actively dangerous — it would answer "is this session
revoked?" with yesterday's answer on a security path.

*Named trigger for revisiting:* a session-revocation feature (log out everywhere, revoke on role
change), or a measured need for the sub-ms token validation the Redis mirror in §3 is there to
serve. Either makes the table necessary and gives it a writer in the same change.
*Rejected:* build both now to match the table count (two unread tables, one of them a security
hazard); build `sessions` only (same problem, half the surface).

## V5.9 T3 — what was done and what was left, with reasons

Scoped down after reading the code. Of the four §3 items, only one had a consumer, and that one was
a live defect rather than a missing column.

**Done — the role projection was misreporting permissions.** `roles.scopes` held wildcards from an
older vocabulary (`tenant:*`, `users:*`, `api_keys:*`) that are not Keto relations and appear nowhere
in `permission-catalog.ts`. §3 names the column `keto_relations` and defines it as the relation set
the role grants, and also says `roles`/`user_roles` are a display projection, not the authoritative
store. So anything rendering a role's permissions from that table showed permissions that are not
granted and omitted ones that are — `ADMIN` projected five wildcards while actually holding every
relation except billing. Renamed, and the seed now derives it from `ROLE_GRANTS` so the two cannot
diverge again. Verified by applying the migration inside a transaction against the dev database
(it renames the column and rewrites the four existing rows) and rolling back.

**Not done, each for a stated reason:**

| Item | Why not |
|---|---|
| `roles.tenant_id` | Nothing creates custom per-tenant roles — the seed is the only writer of `roles`. The column would be unread, and YAGNI is the binding rule here. |
| `api_keys.keto_scope_note` | Nothing reads or writes it. Same reason. |
| `idx_api_keys_tenant_active` partial index | Two reasons. It is an optimisation for a query that is not hot, and more importantly I cannot verify offline whether Prisma 7 can express a partial index in `@@index`. Creating it in SQL only would leave the declared model and the database disagreeing, and this repo's convention is that every hand-written index is mirrored in the schema with `map:` (see `AuditLog`). Needs the Prisma docs, not a guess. |
| `roles` unique → `(tenant_id, name)` | Follows `roles.tenant_id`, and it is not free: `users.service.ts` does `role.findUnique({ where: { name } })`, which stops compiling the moment `name` alone is not unique, and with per-tenant roles a name-only lookup is ambiguous anyway. **Also worth knowing before anyone does it:** Postgres treats NULLs as distinct, so a plain unique index on `(tenant_id, name)` would *not* prevent two global roles with the same name — §3's "tenant_id null for the four standard roles" needs a partial unique index on `name WHERE tenant_id IS NULL` to actually hold. |

## V5.10 T5 — new scope, not alignment drift

Worth separating clearly, because "tenant-service is behind the spec" would be the wrong reading.
Three of the four responsibilities Architecture v5 §2.1 adds are **new features v5 assigned**, not
code that drifted.

**Already present, verified rather than assumed:**

- **The audit sink's store.** `audit_log` exists with §3's columns and indexes, and there is a
  writer, a service and a controller behind it.
- **This service's own erasure handler.** `POST /internal/erasures/operators` erases an operator and
  returns a receipt, gated on the `dsr.erase` service capability. That is precisely the part
  R-CPL-01 assigns to "every other service": each one "implements its own erasure handler and
  returns a receipt". It was built against the older design, where a separate compliance
  orchestrator drove the fan-out.

**What v5 actually moved here: the coordinator role.** R-CPL-01 now makes the Tenant service the
single coordinating owner — it "hosts the consent registry, the DSR endpoint and the DSR fan-out
workflow and the audit sink". The per-service handler exists; the orchestrator does not.

Product Spec §474 states the full contract this implies:

| | |
|---|---|
| Sync APIs | `POST /v1/connections` (provider connections), `POST /v1/dsr` |
| Publishes | `connection.created|revoked`, `consent.recorded`, `dsr.requested`, `erasure.completed`, `audit.logged` |
| Consumes | **erasure receipts from every service** |

None of those five events is published today, and nothing is consumed. `POST /v1/dsr` is Owner-only
and gated on `programs:write` (§618), and it "replaces /v1/erasure-requests under referrers:write"
(§1934).

**Why this stops here rather than being built.** Not because it is large, but because three specific
things are missing that cannot be invented responsibly:

1. **No tables.** DB Model v5 §3 gives nine, and none of them is a consent registry, a DSR request,
   or a provider connection. The data shapes would be mine to invent, including retention and
   residency behaviour for consent records — which is the one area where guessing wrong is a legal
   problem rather than a bug.
2. **Provider secrets are a security design, not a schema.** §2.1 says this service holds "webhook
   signing secrets, tracking-token key" and exposes them "to Event Ingestion through a cache", and
   Event Ingestion's own §2.4 addendum already depends on it for verifying provider signatures. That
   needs an encryption-at-rest and rotation design with a security review — inventing one
   unilaterally for a money path is worse than not having it.
3. **The fan-out is a cross-service contract.** The coordinator has to know every service's erasure
   endpoint and aggregate their receipts. This service's own handler is `POST
   /internal/erasures/operators` with the `dsr.erase` capability; whether the other eight follow that
   convention is not something this repo can answer, and six of them are not mine.

**Recommended shape, for approval rather than silent implementation** — so the decision is cheap to
make and the work is unblocked the moment it is:

- `consents` — subject reference (hashed), tenant, `tracking_consent` / `marketing_consent` (the
  §2.4 enums), `consent_source`, `recorded_at`, `withdrawn_at`. Append-only, so withdrawal is a new
  row and the history survives; current state is the latest row per subject.
- `dsr_requests` — tenant, subject reference, `type ∈ (access, erasure, portability)`, status,
  `temporal_workflow_id`/`run_id` (the same resumability pattern §3 already applies to
  `tenant_verifications`), `requested_by`, `due_at` (the one-month deadline R-CPL-02 names),
  `completed_at`.
- `dsr_receipts` — one row per service per request, with the receipt payload, so `erasure.completed`
  can carry all of them as R-CPL-02 requires.
- `provider_connections` — tenant, provider, `connection_id`, config, and a reference to a secret
  held in a secret manager rather than the column itself. **The secret handling is the part needing
  review.**

## V5.11 Spec defects — additions

6. **Architecture §2.1 says tenant-service "Consumes: None. It is a dependency of other services
   (token validation), not an event reactor."** Product Spec §474 says it consumes "erasure receipts
   from every service", and R-CPL-01 makes it the DSR coordinator, which cannot work without
   consuming them. The two statements cannot both hold.
7. **`POST /v1/dsr` is gated on `programs:write`** (§618). It resolves to Owner-only in practice,
   since no other standard role holds that relation, but gating a data-subject request on a
   *programs* permission is semantically odd and will read as a copy-paste to the next person. A
   `dsr:*` relation, or `api_keys:manage`-style owner-scoped relation, would say what it means.

## V5.12 D5 — the compliance and provider-connection tables, built

§V5.10 recommended four tables and asked for approval rather than implementing them silently. The
approval came on 2026-10-19 ("we are not even on staging — as long as we follow the v5 we can do
them now"), so they exist as of
`src/prisma/migrations/20261019120000_v5_compliance_and_provider_connections`:
`consents`, `dsr_requests`, `dsr_receipts`, `provider_connections`, with models in
`src/prisma/schema/compliance.prisma` and `src/prisma/schema/provider-connection.prisma`.

They are the schema only. **No endpoint, workflow or service code was added** — see "What still has
no code" below for why each piece is still open rather than forgotten.

### Decisions taken, with what was rejected

**D5-a — single-key ULID, against DB Model §0.1.** §0.1 specifies a dual-key model: `pk bigint
GENERATED ALWAYS AS IDENTITY` as the physical key plus `id text` ULID as the business key. Not one
of this service's 22 existing tables does that; all of them are `@id @default(ulid()) @db.VarChar(26)`
under the 2026-09-02 platform ruling recorded in CLAUDE.md, and `20260903003657_ulid_id_harmonize`
converted the last of them. These four follow the 22.

*Rejected:* building them to §0.1 as written. It would make them the only dual-key tables in the
schema, so every join, every repository and every reader would have to know which era a table came
from. If the fleet does move to dual keys, it moves as one migration across all 26 tables, not as
four tables that got there first. **This is a divergence from a written spec, so it is the lead's to
ratify, not mine to settle** — the same §0.1 conflict applies to every table this service already
has, so ratifying it closes 26 cases rather than 4.

**D5-b — the DSR lifecycle states are invented.** R-CPL-02 names the three request *types* (access,
erasure, portability) and the one-month deadline, but no status values. `pending | in_progress |
completed | failed`, shaped after `tenant_verifications.status` so the two operator-facing workflows
read the same way.

*Rejected:* no status column, deriving state from `completed_at` and the receipt count. It cannot
express a failed fan-out, which is exactly the state someone has to act on before the deadline.

**D5-c — the provider list comes from DB Model §10.** `provider_connections.provider` is checked
against `stripe | paddle | chargebee | paypal | wise | gift_card | crm`, which is the list §10
already constrains `inbound_webhook_receipts.provider` to. A connection and the receipt it produces
therefore cannot disagree about who sent a callback.

*Rejected:* a free-text provider column. It is how the retired-event-name problem started — a value
nothing validates becomes a value nothing can rely on.

**D5-d — the webhook secret sits in an encrypted column, and this is the part wanting review.**
`signing_secret` is AES-256-GCM encrypted at rest, matching notification-service's existing
`InboundIntegration.signingSecret`. That is deliberate: Architecture §2.8 moves those receivers to
ingestion (D4), so the secret keeps the handling it already has and the move stays a move.

*Rejected:* a secret-manager reference, which §V5.10 recommended and which is genuinely stronger.
It is a one-column change and no data has to migrate, because nothing is stored yet. **Flagged, not
assumed:** this column should not hold a live provider credential until someone with a security hat
has looked at the encryption and rotation design. Pre-staging is not a reason to skip that, it is
the cheapest moment to do it.

**D5-e — tenant FK with `ON DELETE CASCADE` on all four.** Consistent with `tenant_verifications`
and the other tenant-scoped tables. `dsr_receipts` gets no second FK to `tenants`; it reaches its
tenant through its request, and one cascade path is enough.

*Rejected:* no FK, like `audit_log` and `idempotency_keys`. Those are append-only logs whose rows
outlive their subject on purpose. A consent record with no tenant is not evidence of anything —
you cannot tell whose consent it was — so orphaning it is worse than cascading it.

**D5-f — `idx_provider_conn_live` is a partial unique index.** One live connection per tenant per
provider, `WHERE revoked_at IS NULL`. A plain unique on `(tenant_id, provider)` would make a revoked
connection block its own replacement. Prisma cannot express a partial index, so it lives in the
migration SQL — the same place the CHECK constraints live, for the same reason.

### Verified, not assumed

The migration was applied against the dev Postgres inside a transaction and rolled back, and the
constraints were probed with savepoints in the same transaction. Observed:

- all four tables and all ten CHECK constraints create cleanly; nothing was left behind (confirmed
  by re-querying `information_schema.tables` afterwards — none of the four exist)
- a second *live* `(tenant, stripe)` connection is rejected; after revoking the first, the
  replacement is accepted — the partial index does what it is there for
- `provider = 'monzo'` rejected, `request_type = 'deletion'` rejected (v5's word is `erasure`), a
  consent row with no subject reference rejected
- a second receipt from the same service for the same request rejected; deleting the request takes
  its receipts with it
- `pnpm test` 497/497 pass; `tsc --noEmit` reports 28 errors, the unchanged pre-existing baseline

### What still has no code, and why

1. **`POST /v1/dsr`, the consent registry endpoints, and the fan-out workflow.** The fan-out is a
   cross-service contract: the coordinator has to know all eight other services' erasure endpoints
   and aggregate their receipts. This repo can answer for its own handler
   (`POST /internal/erasures/operators`, capability `dsr.erase`, already implemented in
   `src/features/users/operator-erasure.controller.ts`); it cannot invent the other eight. Six of
   them are not mine.
2. **Provider-connection CRUD and the encryption helper** — gated on D5-d's security review.
3. **Exposing connections to ingestion through a cache**, which Architecture §2.1 requires and which
   D4 depends on. The table is the half this service owns; the cache contract is a cross-service
   item and belongs with D4.
4. **§V5.11 defects 6 and 7 are still open and bear on this.** Architecture §2.1 says this service
   consumes nothing while Product Spec §474 has it consuming erasure receipts from every service —
   `dsr_receipts` is built for the Product Spec reading, because R-CPL-01 cannot work under the
   other one. And `POST /v1/dsr` is still gated on `programs:write` (§618), which resolves to
   Owner-only but says the wrong thing.

## V5.13 D4 step 1 — provider connections, the half this service owns

D4 moves the inbound provider receivers and the email-tracking endpoints from notification-service to
ingestion-service (Architecture v5 §2.4/§2.8 and API Contract §6.5, both carrying the dated
2026-10-12 addendum; DB Model §10 still assigns them to notification and is the lagging document —
tiebreak recorded in `event-svc/NOTE.md` §11.9). Ingestion cannot verify a provider callback without
the connection secret, and Product Spec §12 lists "connection config and tracking-token key (cache
from Identity & Access)" among Event Ingestion's inputs — so this service goes first.

Built here: `POST /v1/connections`, `GET /v1/connections`, `DELETE /v1/connections/{id}`, and
`GET /v1/internal/connections/{provider}/{connectionId}` for ingestion's cache, over the
`provider_connections` table from §V5.12.

### Decisions taken, with what was rejected

**D4-1 — the `POST /v1/connections` body is this service's proposal, not a contract.** API Contract
§6.5 names the endpoint and its authorization ("Owner, `api_keys:manage`") but §3.1 marks the body
"still to author". The shape is `{ provider, connection_type, name?, signing_secret, config? }`, and
the response carries `receiver_url` so the operator gets the URL to paste into the provider's console.

*Rejected:* waiting for §3.1 to be authored. Nothing downstream can be built without a connection to
read, and a body this small is cheap to change. It is flagged so a later §3.1 is a diff against a
stated proposal rather than a surprise.

**D4-2 — `api_keys:manage`, not a new `connections:*` relation.** §6.5 names that relation, and it is
already the platform's relation for "credentials that let something talk to the platform". A new
relation would need provisioning in Keto for every existing tenant.

*Rejected:* a `connections:manage` relation, which would say what it means more precisely. Worth
raising with §V5.11 defect 7 (`POST /v1/dsr` gated on `programs:write`) as one naming question
rather than two.

**D4-3 — the provider list is the category list, not API §6.5's revision line.** §6.5's revision
names `stripe, paddle, chargebee, paypal, wise, tremendous`; the table directly below it and DB
Model §10's CHECK both name `… wise, gift_card, crm`. Two of three mentions name categories and one
names a vendor, so categories win and `gift_card` covers Tremendous/Tango.

*Rejected:* following the revision line as the newest text. It would make `provider` a mix of six
categories and one vendor, and would drop CRM — which §6.5's own table lists as a source. Recorded
as a spec defect in §V5.14.

**D4-4 — one live connection per tenant per provider, enforced in the database.** `idx_provider_conn_live`
is partial on `revoked_at IS NULL`, so a second live Stripe connection is a 409 and cannot quietly
take over the first one's callbacks, while a revoked one steps aside for its replacement.

*Rejected:* allowing several and letting the path disambiguate. The path does identify the
connection, but two live secrets for one provider means a callback verified by the wrong one is
indistinguishable from a legitimate one at the audit level.

**D4-5 — rotation is replacement.** There is no `PUT` on a connection's secret: revoke and create.
That changes the receiver URL, which is the point — the provider has to be reconfigured, so there is
no window where the old secret still verifies.

*Rejected:* a rotate endpoint mirroring `POST /v1/api-keys/{id}/rotate`. An API key is presented by
our own SDK, which we can update; a provider secret is held in the provider's console, which we
cannot.

**D4-6 — the internal read is the one endpoint that returns a decrypted secret.** Service-token only,
with its own capability `provider_connection.read` rather than reusing `tenant_entitlements.read`, so
granting ingestion the ability to read connections does not also grant it anything else. It resolves
across tenants on purpose: a provider callback carries no tenant context, and the connection id in
the path is what establishes it.

*Rejected:* having ingestion verify through a call to this service ("send me the body, tell me if the
signature is good"). It would put this service on ingestion's per-callback path and make it a
latency and availability dependency of the most internet-exposed surface. The cache is what §2.1
specifies, and caching requires handing over the secret.

**D4-7 — `connection.created|revoked` are a cache-invalidation contract.** Product Spec §12 lists
them among this service's published events; because ingestion caches connections, their arrival is
what makes a revoked connection stop verifying before the cache TTL. The payload carries the
connection id, provider and actor, and never the secret (asserted in the specs).

**D4-8 — no `last_received_at` on the connection.** It was in §V5.12's first cut and is now removed
from the model and the migration. Ingestion is what receives the callbacks and holds no RDS, so
stamping the column would mean a write to this service on every verified callback — exactly the
hot-path dependency D4-6 refuses. "Last received" is a `(provider, received_at desc)` read over the
receipt audit, which DB Model §10 already indexes for it.

The migration was amended rather than superseded by a second one: it has never been applied anywhere
(dev Postgres holds none of the four tables), so there is nothing forward-only to respect yet.

### Verified

- `pnpm test` 518/518; `pnpm test:bdd` 34 scenarios / 183 steps, exit 0 — the BDD run boots the whole
  app, so the new module's wiring is exercised, not just compiled
- `tsc --noEmit` at the unchanged 28-error baseline; `pnpm build` compiles; `pnpm lint` 0 errors
- the secret is asserted absent from the create response, from the published event and from the
  stored column in the clear; a tampered ciphertext is refused by the GCM tag rather than returning
  garbage; a missing encryption key fails the create instead of storing something unreadable

### Still open for D4

1. **`PROVIDER_SECRET_ENCRYPTION_KEY` is in Helm as an empty secret var.** Without it this service
   boots but refuses to create or resolve a connection. That is deliberate (fail loudly, never store
   a secret nothing can read back), but it means the value has to be supplied before the receivers
   can work in any environment.
2. **The security review from §V5.12 D5-d is now concrete:** there is an endpoint that returns a
   decrypted provider secret to a service token. The authorization is deny-by-default and
   capability-scoped, and the secret never reaches a human-facing response or a log — but this is the
   part to put in front of someone before it holds a live credential.
3. **The tracking-token key** (Architecture §2.1, Product Spec §12) is not built. Notification signs
   the token and ingestion verifies it, so both need the key from here — that lands with the
   `/t/o`, `/t/c` step.
4. **Where the `inbound_webhook_receipts` audit lives is still undecided.** DB Model §10 and §13 put
   it in notification_db with a Redis dedup key in notification's namespace; Architecture §2.4 gives
   ingestion no RDS and §2.8 makes notification outbound-only, so as v5 stands nobody can write the
   table that Failure §4.3's revenue reconciliation reads. The recommendation is that ingestion
   publishes a payload-less receipt event and notification keeps the table and writes it from the bus
   — which honours "the payload is dropped, not queued" (the dropped-signature receipt stores no
   payload anyway, per §10) while keeping the table where the DB Model puts it. Recorded here because
   it is the one D4 question that is not mine to settle quietly.

## V5.14 Spec defects — additions

8. **API Contract §6.5's revision line and its own table disagree on the provider list.** The revision
   names `stripe, paddle, chargebee, paypal, wise, tremendous`; the table below it lists Stripe,
   Paddle, Chargebee, PayPal/Wise, "Gift-card (Tremendous/Tango)" and "CRM (HubSpot/Salesforce)", and
   DB Model §10's CHECK is `('stripe','paddle','chargebee','paypal','wise','gift_card','crm')`. The
   revision swaps a category for one vendor inside it and drops CRM entirely. Implemented as the
   category list (NOTE.md §V5.13 D4-3).
9. **`inbound_webhook_receipts` has no owner once the receivers move.** DB Model §10 puts the table
   and its `inbounddedup:{integration_id}:{provider_event_id}` Redis key in notification-service, and
   §13's matrix repeats it; Architecture §2.4 gives ingestion no RDS at all and §2.8 makes
   notification outbound-only, never receiving these callbacks. Failure §4.3's Billing-to-Platform
   Revenue reconciliation reads that table. As the suite stands, no service can write it. §V5.13's
   open item 4 carries the proposed resolution.
10. **DB Model §13 does not list an inbound dedup key for ingestion.** Ingestion's Redis row is
    "dedup, touch dedup, 3× rate-limit, campaign cache, code mirror, session map"; the inbound dedup
    key is still in notification's row. Mechanical consequence of defect 9 — the DB Model was not
    revised for the 2026-10-12 receivers move, which is also what makes it the lagging document in
    the D4 tiebreak.

## V5.15 D4 step 3 — the email-tracking token key

Architecture v5 §2.1 puts the tracking-token key in this service, and Product Spec §12 lists it among
Event Ingestion's cached inputs. Notification-service signs the `/t/o/{token}` and `/t/c/{token}`
tokens at send time; ingestion verifies them when the recipient opens or clicks. Both read the value
from `GET /v1/internal/tracking-token-key`, under the new capability `tracking_token.read`.

**D4-16 — one platform key, not one per tenant.** §2.1 names it in the singular, next to the plural
"webhook signing secrets", and the token carries the tenant id *under* the signature — so a per-tenant
key would add rotation surface without adding isolation.

*Rejected:* a per-tenant key. It would also mean the verifier has to decide which key to use from an
unverified payload, which is a worse shape than one key over a signed tenant id.

**D4-17 — its own capability, separate from `provider_connection.read`.** Notification needs the
tracking key and must never get provider secrets; ingestion needs both, but as two grants. One
capability covering "the secrets tenant-service holds for others" would have given notification the
billing credentials.

**D4-18 — 503 when the key is unset, never an empty string.** A caller that received `""` would sign
and verify with it and every forged token would pass. The correct caller response is to fail and
retry, which is what 503 says.

**No tenant-facing route.** No operator needs this value, and an endpoint returning it to a dashboard
session would be a way to mint tracking touches for another tenant.

The value is one per environment (Helm `TRACKING_TOKEN_KEY`), and rotating it invalidates the tokens
in mail already sent — tracked in the Helm comment, because that is where someone will be when they
consider rotating it.

## V5.16 D5 step 2 — the DSR pipeline and the consent registry, built

Product Spec R-CPL-01 makes this service compliance's one coordinating owner: "the Tenant service
hosts the consent registry, the DSR endpoint and the DSR fan-out workflow and the audit sink; every
other service implements its own erasure handler and returns a receipt." §V5.12 built the three
tables. This builds what uses them.

| what | where |
|---|---|
| `POST /v1/dsr`, `GET /v1/dsr/{id}` | `features/compliance/dsr.controller.ts` + `dsr.service.ts` |
| erasure fan-out across the six targets | `dsr-fanout.service.ts` + `dsr-fanout.worker.ts` |
| the remote erasure call | `erasure.client.ts`, `dsr-targets.ts` |
| consent registry, written off the bus | `consent.consumer.ts` + `consent.service.ts` |
| the four compliance events | `common/events/outbox/published-events.ts` |
| this service's first outbound service token | `common/clients/service-token.provider.ts` |

### Decisions taken, with what was rejected

**D5-6 — BullMQ with the state in Postgres, not Temporal.** R-CPL-02 says "Erasure fans out as a
Temporal workflow". This service has no Temporal client, no worker and no `temporal` entry in
`package.json`; the three `temporal_*` columns §V5.12 added are written from an inbound DTO in
`tenant.service.ts`, never by a workflow here. What a fan-out actually needs from a workflow engine is
resumability, and the unique `(dsr_request_id, service_name)` on `dsr_receipts` gives that directly: a
run asks only the targets that have not answered, so a crash, a BullMQ retry and the hourly sweep all
converge on the same six receipts. Nine BullMQ workers already run here.

*Rejected:* standing up Temporal for one workflow. It would make the platform's compliance path depend
on a component this service does not otherwise use, for a guarantee the unique constraint already
gives. The columns stay — they are the handle a later migration to Temporal would write into, and
dropping them would be a second migration for nothing.

**D5-7 — the consent registry is built by consuming touch events.** API Contract §3.15 is explicit:
"Consent is a field on touch events (captured from CMP by JS SDK), **not a standalone resource**."
There is no endpoint to write consent to, and R-CPL-01 still makes this service the registry's owner.
The only reconciliation is to read the bus, so this service now consumes `tenant-svc.fifo`, subscribed
to ingestion's `ingestion-events` topic.

*Rejected:* a `POST /v1/consent` of our own (§3.15 forbids it, and the SDK would have no reason to call
it), and having ingestion write the registry (it owns no RDS, and R-CPL-01 assigns the registry here).

Append-only, per DB Model §0.4: a change of mind is a new row. A signal that repeats what is already on
file is dropped, so the table grows with decisions rather than with traffic — which matters, because
this read runs on every touch event that carries a consent block. A row recording a denial after a
grant carries `withdrawn_at` itself; no earlier row is ever edited.

**D5-8 — erasure runs end to end; access and portability are accepted and dated.** R-CPL-02 specifies
a fan-out for erasure only. For access and portability it gives no collect contract, no response
format and no per-service shape, so the request is recorded with its deadline, answerable at
`GET /v1/dsr/{id}`, and resting at `accepted`.

*Rejected:* inventing six "collect my share" contracts. Five of the six services do not exist in this
working set; a guessed contract implemented on one side is worse than a recorded gap, because it reads
as done.

**D5-9 — Identity's share runs in-process.** The fan-out calls `OperatorErasureService.erase()`
directly rather than `POST`ing to its own `/internal/erasures/operators`. Same handler either way, and
a self-call would need this service to mint and verify a token for its own endpoint.

The guard that came with it: an operator record is only ever matched by email hash, because
`subject_id` and `subject_external_id` name a participant or invitee — a different id space. A DSR
naming the subject only by external id gets a `completed` Identity receipt saying so, rather than a
call that would have matched `emailHash: undefined`, which in Prisma is no filter at all.

**D5-10 — a target that cannot answer is a `pending` receipt, not a failure.** No v5 document
specifies the erasure handler contract the other five services implement, so
`POST {base}/api/v1/internal/erasures/subjects` is this service's proposal, mirroring its own handler.
Today all five answer 404. That leaves a `pending` receipt carrying the reason, and the hourly sweep
asks again — so the request shows exactly who still owes an answer instead of failing wholesale, and
starts completing on its own as each endpoint ships. A 4xx that is not 404 is recorded `failed`
instead: the target answered and refused, which is a grant to fix, not a retry.

**D5-11 — `dsr:manage`, over both permissions §3.15 names.** §3.15's table says `referrers:write` /
`referrers:read`; its own revision line says "Owner-only — permission to update to `programs:write`".
The contract disagrees with itself and neither candidate is about data-subject requests. All three
resolve to Owner-only today, so effective access is identical; a separate permission is what later
lets a compliance officer answer DSRs without also being able to edit participants or programs.
Ratified 2026-10-20 with the catalog addition.

**D5-12 — 30 days, from the two statements of one deadline.** API §3.15 says "Processed within 30
days"; R-CPL-02 says "within the client's legal deadline (one month)". Same deadline, and 30 days is
the one with a number, so that is what `due_at` is stamped with at submission — which is also what
makes an overdue request a query on `idx_dsr_tenant_status`.

**D5-13 — `erasure.completed` carries its receipts as one JSON string.** R-CPL-02: the event "carries
all receipts". Event Model §2.5: properties are flat, primitives only. Both hold if every receipt
travels as one string property, with `receipt_count` and `retained_under_obligation` alongside for
consumers that only need the summary, and the per-service detail readable at `GET /v1/dsr/{id}`.

**D5-14 — `audit.logged` is published for the compliance record only.** `AuditLogWriter` already turns
every published event into an `audit_log` row, so an event per row would be a firehose and would audit
itself. `audit.logged` is therefore emitted once per completed erasure, announcing that the record
exists and where to read it, and is excluded from the trail (`NOT_OPERATOR_ACTIONS`).
`erasure.completed` was added to `AUDITED_WHEN_SYSTEM` so the erasure itself is audited even though no
operator performed it — DB Model §0.5's rule. `consent.recorded` is excluded too: it is the subject's
own choice arriving off the bus, not an operator action.

### Verified, not assumed

| claim | how |
|---|---|
| the four compliance mappers produce valid Event Model drafts | `published-events.spec.ts` — its "covers every mapper" test now holds 41 events |
| no subject's address reaches the bus | the same suite's "never puts an email address or a raw token on the bus" |
| a re-run asks only the unanswered targets | `compliance.spec.ts` — two already-answered targets, four calls |
| a pending target blocks completion | the request stays `in_progress`, no event emitted |
| Identity is never asked to erase a subject it cannot match | `operators.erase` not called; receipt says why |
| the sweep survives one request failing | three swept, one failed, two accounted for |
| unit suite | **572 passed / 55 suites** (was 530 / 51) |
| typecheck | **27 errors**, unchanged — all pre-existing (see §11.16 in event-svc's NOTE) |

Not verified: nothing ran against live infrastructure. Docker was down for this pass, so the SNS
subscription, the SQS consumer and the 404-to-pending path have no live run behind them.

### Still open

1. **The migration is written but not applied.** `20261021120000_consent_external_id_index` adds
   `idx_consent_external_id`. `ConsentService` reads the registry on every touch event carrying a
   consent block, and a subject named only by `invitee_external_id` had no index to read —
   `idx_consent_email` covers the hashed address and `idx_consent_subject` the platform id. One
   `CREATE INDEX`, needs the usual approval before it is applied.
2. **The erasure handler contract needs ratifying by the other five services.** `dsr-targets.ts` and
   `REMOTE_ERASURE_PATH` are the proposal; nothing confirms it.
3. **The four compliance event payloads are this service's.** See spec defect 11 below.
4. **`SQS_POLLING_ENABLED` is still `false` in tenant-service's `.env.development`.** It was false
   because the queues did not exist; they do now, and the consent consumer needs it true to receive
   anything. Flipping it is a live-behaviour change, so it waits for a run with Docker up.
5. **`services.tracking` defaults to port 5005**, which is the port notification-service actually
   runs on and which the new `services.notifications` entry therefore also claims. The older default
   looks wrong; not this change's to move.

## V5.14 Spec defects — additions (continued)

11. **The compliance event family has no payload anywhere in the Event Model.** R-CPL-01 names
    `consent.recorded`, `dsr.requested`, `erasure.completed` and `audit.logged` as "Event Model
    compliance family". All four appear only in the Product Spec — two, three, four and three
    mentions respectively — and nowhere in the Event Model: no payload, no `object_type`, no schema
    version. `erasure.completed` is the one R-CPL-02 constrains at all ("carries all receipts"), and
    that constraint contradicts §2.5's flat-properties rule. Implemented as §V5.16 D5-13/D5-14 and
    going back as a patch.
12. **Architecture §2.1 says tenant-service "Consumes: None" while R-CPL-01 gives it the consent
    registry.** API Contract §3.15 puts consent on touch events and says it is "not a standalone
    resource", so there is no endpoint through which the registry could be written. Holding it
    requires reading the bus. §2.1 needs correcting; implemented as §V5.16 D5-7.
13. **R-CPL-02 specifies a fan-out for erasure only.** `access` and `portability` are named as DSR
    types in the same sentence and then never given a collect contract, a response format or a
    per-service shape. Implemented as §V5.16 D5-8 — recorded, dated, and resting at `accepted`.
14. **No v5 document specifies the erasure handler every service is required to implement.** R-CPL-01
    says "every other service implements its own erasure handler and returns a receipt" and R-CPL-02
    lists what each one erases, but no path, no request body and no receipt shape appear anywhere.
    The orchestrator is the only place it can be stated, so §V5.16 D5-10 states it as a proposal.

## V5.17 The erasure handler contract was not a guess after all — and the fan-out did not match it

§V5.16 D5-10 recorded `POST /api/v1/internal/erasures/subjects` as this service's proposal, "because no
v5 document specifies that contract". The path is right. Two of the five remote targets already
implement it, and reading them showed the fan-out would have failed against both.

| service | handler | authorizes on |
|---|---|---|
| analytics-service | `POST /api/v1/internal/erasures/subjects` | the token's **`dsr.erase` scope** (`ServiceScopeGuard`) |
| notification-service | the same path | the **Keto tuple** `services:dsr.erase#call` (`AllowServices`) |
| tenant-service (this one) | `…/erasures/operators` | the Keto tuple |

Their request and receipt shapes agree with each other, so the contract is real and already settled by
two implementations — it just was not the one §V5.16 shipped.

### Three defects in the fan-out, found by reading the two live handlers

**1. `tenant_id` was not sent, and it is required.** Both DTOs declare it `@IsString()` non-optional,
and analytics' guard refuses a service token that does not name a tenant at all: "A service token must
name the tenant it is acting for" — it has no tenant claim of its own, so the tenant comes from the
call. Every fan-out call would have been a 400, which `ErasureClient` classifies as *refused* and
records `failed`: the DSR would have shown two permanently failed targets with nothing to fix.

**2. The body was camelCase.** Every service in the fleet runs the global snake_case wire transform —
analytics' guard reads `tenant_id` off the raw body precisely because "the wire is snake_case and
`WireCaseInterceptor` has not camel-cased anything yet". With `forbidNonWhitelisted: true` in the
ValidationPipe, `dsrId` and `subjectEmailHash` would have arrived as unknown properties and been
refused. Same class of defect as the `ConnectionWire` one in event-svc §11.15 — and the same cause:
this service's own transform makes it easy to forget the wire is not the TypeScript shape.

**3. `subject_external_id` and `subject_id` are not fields the contract has.** `subject_id` maps to
`participant_id`, which both DTOs do have. `subject_external_id` has no counterpart anywhere, and
sending it would itself have been a `forbidNonWhitelisted` 400.

Fixed in `erasure.client.ts`: `SubjectErasureWire` is explicitly snake_case, `tenant_id` travels,
`subject_id → participant_id`, and `user_id` is deliberately never sent — it names an *operator*, which
is Identity's own share and runs in-process.

### Decisions taken, with what was rejected

**D5-15 — request the `dsr.erase` scope as well as holding the Keto tuple.** The fleet's own rule
(`scripts/service-clients.sh`) is "scope is deliberately not used for authorization: a scope is
self-asserted by the caller at token time, whereas a Keto tuple is granted by the platform". analytics
checks the scope anyway. So tenant-service's Hydra client is now registered with `scope: "dsr.erase"`
and `ServiceTokenProvider` requests it (`SERVICE_AUTH_SCOPE`). Hydra refuses a token request for a
scope the client is not registered for, so the scope is constrained by registration — the header's
objection is weaker than it reads.

*Rejected:* changing analytics to authorize on Keto. It is the right end state and it is one service's
guard, but it is a change to a service that is working, for a caller that did not exist until now, and
it would have to ship before the fan-out could. Doing it the other way round means the fan-out works
today and analytics converges later. Recorded as open item 6.

**D5-16 — a subject with neither a participant id nor an email hash is not called at all.** The
contract has no field for the client's own identifier, so a DSR naming the subject only by
`subject_external_id` can be addressed nowhere. `ErasureClient` records a `pending` receipt saying so
instead of making five calls that would each be refused — and the sweep re-asking costs nothing,
because no HTTP call is made until the contract grows the field. Spec defect 15.

*Rejected:* recording it `failed`. It is not a failure of the target; it is a hole in the contract, and
`failed` is the state an operator is supposed to act on.

### Verified

| claim | how |
|---|---|
| the wire body matches what both live DTOs accept | `compliance.spec.ts` asserts the exact snake_case body |
| `not_found` counts as answered, `blocked` does not | two cases in the same suite |
| an unnameable subject makes no HTTP call | `http.post` not called; receipt says why |
| unit suite | **574 passed / 55 suites** |
| typecheck | **27 errors**, unchanged baseline |

Still not run live: Docker is down, so the scope registration, the token request and the two real
handlers have no end-to-end run behind them. This is the first thing to do when the stack is back up —
`POST /v1/dsr` with an erasure should now come back with analytics' and notification's receipts
`completed` and the other three `pending`.

### Added to §V5.16's open list

6. **analytics-service authorizes the erasure handler on the token scope, not on Keto.** It is the
   only service in the fleet that does. Converging it on `AllowServices` would let
   `SERVICE_AUTH_SCOPE` and the client's registered scope go away.
7. **`dsr_receipts.service_name` is this service's naming, and the receipts say their own.** Analytics
   returns `service: "analytics-service"`, notification `"notification-service"` — both match
   `ERASURE_TARGETS`. The three unimplemented ones are unconfirmed.

## V5.14 Spec defects — additions (continued)

15. **The erasure handler contract has no field for the client's own subject identifier.** `POST /v1/dsr`
    can name a subject by email, by the platform's participant id, or by `subject_external_id` — and
    the two implemented handlers accept only the first two. A DSR submitted with just an external id
    is therefore unexecutable, which is a gap in R-CPL-02 rather than in any one service: the identity
    the Owner has is not always the identity the services hold. Recorded as §V5.17 D5-16; the fix is
    one optional field on the handler contract.
16. **R-CPL-01's "every other service implements its own erasure handler" is implemented three
    different ways.** Two services authorize it on a Keto capability, one on an OAuth2 scope, and the
    paths differ for the subject type (`/erasures/subjects` vs `/erasures/operators`). The suite names
    neither the path nor the authorization mechanism, so each service chose. Worth stating once in
    the Architecture document, since the orchestrator has to satisfy all of them at the same time.

## V5.18 The live pass that is still owed, and how to run it

Everything in §V5.16 and §V5.17 is verified at unit level (574 tests) and compiles for production
(`nest build` clean — which is the stronger signal, because the 27 `tsc --noEmit` errors are all in
spec files the build excludes). **Nothing ran against live infrastructure**: Docker was not running on
this machine for the whole pass, and starting the stack and bringing up ten containers while nobody
was at the keyboard was not a call to make unasked.

This is the recipe, in order, with what each step proves. Steps 1–3 are prerequisites that changed in
this pass, so a stack started from an older state will not exercise the new paths.

### 1 · Infrastructure — two scripts must be re-run, not just the stack started

```
cd D:\Projects\Work\REFERRAL\v2-infra\referral-pulse-infrastucture\local
docker compose up -d
./scripts/service-clients.sh
```

- `service-clients.sh` **must** re-run: `upsert_client` now registers tenant-service's Hydra client
  with `scope: "dsr.erase"`. Without it, Hydra refuses the token request as an unregistered scope and
  the fan-out cannot call analytics-service at all (§V5.17 D5-15).
- LocalStack runs `01-queues-and-topics.sh` on container start, so a fresh `up` picks up the new
  `ingestion-events.fifo → tenant-svc.fifo` subscription. On an already-running container:
  `docker exec rp-localstack bash /etc/localstack/init/ready.d/01-queues-and-topics.sh`.

### 2 · The migration — an approval gate, so it is deliberately not applied

```
cd D:\Projects\Work\REFERRAL\referral-scope-ahmed\referral-pulse-tenant-svc
npx prisma migrate deploy
```

One `CREATE INDEX` (`20261021120000_consent_external_id_index`). Without it the consent registry still
works, but the lookup for a subject named only by `invitee_external_id` is a sequential scan on every
touch event carrying a consent block — see §V5.16 open item 1 for why that read is hot.

### 3 · One env flag

`SQS_POLLING_ENABLED` is still `false` in `.env.development`. It was false because the queues did not
exist; they do now. The consent consumer receives nothing until it is `true`.

### 4 · What to run, and what each check proves

| check | how | proves |
|---|---|---|
| the consent registry reads the bus | send a touch with a `consent` block through ingestion's `POST /v1/events`, then `select * from consents` | §V5.16 D5-7 — the SNS subscription, the consumer, and the hash-not-address rule |
| an unchanged signal is dropped | send the same touch twice | the table grows with decisions, not traffic |
| the fan-out reaches the two live targets | `POST /v1/dsr` with `{"request_type":"erasure","subject_email":"…"}`, then `GET /v1/dsr/{id}` | §V5.17 — the snake_case body, `tenant_id`, and the `dsr.erase` scope all at once |
| the other three are pending, not failed | the same `GET` | §V5.16 D5-10 — a 404 is a pending receipt with its reason |
| the request completes on its own | wait for the `:35` sweep, or re-enqueue | the resume path: only unanswered targets are re-asked |
| `erasure.completed` and `audit.logged` reach the bus | `select * from event_outbox where event_type like 'erasure%' or event_type = 'audit.logged'` | the four compliance events and their flat payloads |

**Expected result for the fan-out today:** `tenant-service` completed, `analytics-service` completed,
`notification-service` completed, and `referral-workflow-service`, `reward-service`, `ai-service`
pending with `"unanswered": "ECONNREFUSED"` — those three are not in this working set and are not
running. The request therefore stays `in_progress`, which is the designed behaviour, not a failure.

**Getting an Owner token.** `POST /v1/dsr` is gated on `dsr:manage`, which lives in the internal JWT's
`perms`, and locally there is no gateway to mint one. Use the same approach as §11.16's live run in
event-svc: sign an internal JWT with this service's `INTERNAL_JWT_PRIVATE_KEY` and the Owner's claims
— `test/bdd/support/jwt.helper.ts` is the reference for the exact issuer, audience and claim set.

### 5 · Not covered by any of this

The `/t/o` + `/t/c` round trip. Notification-service signs the tokens now and ingestion verifies them,
but no route carries an `invitation_id` yet, so there is no mail to click. See
`referral-pulse-notification-svc/NOTE.md` §N5.8 and
`my-docs/cross-service-requirements.md` §3.10.

## V5.19 The live pass — six defects, and the DSR path working end to end (2026-10-22)

§V5.18 listed the live run as owed. It ran. **Every one of the six things it found was invisible to 574
passing unit tests**, and five of the six would have made the fan-out fail in production.

### It works now

```
POST /api/v1/dsr  →  201
GET  /api/v1/dsr/{id}  →  200
   tenant-service              completed   (in-process)
   analytics-service           completed   retained
   notification-service        completed   retained
   referral-workflow-service   pending     ECONNREFUSED
   reward-service              pending     ECONNREFUSED
   ai-service                  pending     ECONNREFUSED
   status: in_progress
```

The three pending ones are the services not in this working set and not running — exactly the designed
behaviour (D5-10), not a failure. `dsr.requested` and `consent.recorded` both reached SNS through the
outbox relay; a touch event published to `ingestion-events.fifo` produced a `consents` row whose
`subject_email_hash` is the SHA-256 of the address, with `recorded_at` taken from the event's own
`occurred_at` and `marketing_consent` / `consent_source` read from the envelope.

### The six defects

**1 · `AUTH_ALGORITHMS=RS256` — this service could not verify its own internal JWT.**
`InternalTokenService` signs **ES256** and the published JWKS says so, but `.env.development` listed
RS256 only, so every dashboard request answered 401 "invalid algorithm". `.env.test` already had
`RS256,ES256`, which is why the BDD suite — where every request carries an internal JWT — never saw it.
**Worse:** the whole `AUTH_*` family (ten keys, every one required with no Zod default) was **missing
from `deployment/helm/values.yaml`**, so a pod from this chart dies at boot with "Auth config
validation failed". Both fixed; the Helm block carries the ES256/RS256 reasoning inline.

**2 · The outbound interceptor deleted the credentials it was given.**
`HttpOutboundInterceptor`'s external branch did `delete config.headers['Authorization']`
unconditionally. Hydra's token endpoint is not in `internalServiceDomains`, so the HTTP Basic header
`ServiceTokenProvider` had just attached was stripped and Hydra answered **400, no client
authentication**. This service could therefore never obtain a service token, and never call another
service at all. Because the token fetch sits inside `erase()`'s try block, the single 400 was recorded
as *every* target's answer — five receipts reading "HTTP 400", none of which had been contacted.

This is the **same defect, in the same file, as event-svc §11.15** — fixed there a day earlier and
never ported. It stayed invisible here because tenant-service had no outbound service call until the
DSR fan-out.

**3 · `pending` was not in the `dsr_receipts` status CHECK.**
The most consequential one. §V5.12 wrote `CHECK (status IN ('completed','partial','failed'))` from the
schema comment, before the fan-out existed; D5-10 then made "cannot answer yet" a `pending` receipt —
which is the *normal* case today. Every pending write violated the constraint, failed the BullMQ job,
and left the fan-out stalled at the first unreachable target with no receipt for it, retrying three
times and giving up. Migration `20261022060000_dsr_receipt_pending_status` adds it.

The unit tests could not catch this: they mock Prisma, and a mock has no CHECK constraints.

**4 · The circuit breaker was keyed on hostname, so one dead service shut out the healthy ones.**
`new URL(url).hostname` meant every service on one host shared a breaker. Locally that is all of them,
so three dead targets opened the breaker and the fan-out recorded a **running** notification-service as
`"unanswered": "Breaker is open"` — a wrong answer about a healthy service. Now keyed on `host`, so the
port is part of the identity. In a cluster the hostnames already differ, so this is mostly a local
artifact — but a local artifact that silently corrupts a compliance record is worth one word.

**5 · `GET /v1/dsr/{id}` was a 500 on every call.**
`withTenantFilter` adds `deletedAt: null` unless told not to, and `dsr_requests` has no `deletedAt`
column — a DSR is the proof the request was answered, so it is never soft-deleted. Prisma rejected the
query as an unknown argument. The unit test passed because its mock of `withTenantFilter` returned
`{...where, tenantId}` and skipped the part that breaks. **The mock now mirrors the real
implementation**, including the `deletedAt` it adds, which is the only reason the test is worth having.

**6 · `retained` has two shapes, and a refused connection had no reason.**
notification-service answers with a list of legal bases, analytics-service with one sentence.
`Array.isArray(...) ? ... : []` read the sentence as "nothing retained" — the opposite of what it says
— so analytics' receipt lost the flag the subject has to be told about. And a refused connection
arrives with an empty `message` and the reason only in `code`, which wrote `"unanswered": ""` into the
one field whose job is to say why. Both read both ways now.

### What this says about the test suite

Four of the six were *hidden by a mock that was kinder than reality*: a Prisma mock with no
constraints, a `withTenantFilter` mock that skipped its own behaviour, a receipt fixture with only one
of the two live shapes, and an error fixture with a `message`. The two that were not — the algorithm
list and the interceptor — were config and a file no test in this repo exercises end to end.

The lesson is the same one §11.17 drew for the wire format: **a unit test written against the same
assumption as the code cannot find the assumption wrong.** For anything crossing a process boundary,
the cheap check is to call it.

### Verified

| claim | how |
|---|---|
| `POST /v1/dsr` → 201, hash not address, deadline +30 days | live, twice, with a ULID tenant |
| `GET /v1/dsr/{id}` → 200 with all six receipts | live |
| the two live handlers answer `completed` with `retained` | live, through the fan-out *and* probed directly |
| unreachable targets become `pending` with their reason | live, three of them |
| `dsr.requested` and `consent.recorded` reach SNS | `event_outbox` rows, both `published` |
| the consent registry hashes the address and keeps the event's own time | live row, hash checked against `sha256(address)` |
| the fan-out resumes rather than restarts | successive attempts re-asked only the unanswered target |
| unit suite | **581 passed / 55 suites** (was 574) |
| typecheck | 27 errors, unchanged baseline; `nest build` clean |

Two pre-existing tests in `http-layer.spec.ts` asserted the old behaviour of defects 2 and 4 and now
assert the new: a forwarded token is stripped from an external call, a credential the caller set
deliberately is not.

### Still open

1. **`erasure.completed` and `audit.logged` have not fired**, because they need all six targets to
   answer and three of the six are services that do not exist here. The path is covered by unit tests;
   it will fire on its own the first time the other three run.
2. **The `:35` sweep has not been observed resuming a request on its schedule** — only the
   resume-on-retry path, which is the same code.
3. **Idempotency.** `POST /v1/dsr` requires an `Idempotency-Key` header (API §1, the global
   interceptor). Worth noting because it is not in §3.15's description of the endpoint, and a caller
   reading only the contract will get a 400.
4. **Dev seed tenants are not ULIDs.** `default-tenant` and `AZP-772-OMEGA` are 14 and 13 characters;
   notification-service's erasure DTO requires `@Length(26, 26)` on `tenant_id`, correctly, so a DSR
   for either of them is refused with a 400 that looks like a contract bug and is not. A ULID tenant
   was created for this run.

## V5.20 Product-spec pass — the invitation channel, and two grants that were missing (2026-10-22)

A full read of Product Spec v5 (87 rule cards) against this service turned up three concrete gaps.
Two were one-liners; the third was a responsibility with no home.

### A5-16 · R-PRT-02's invitation channel did not exist here

R-PRT-02 governs platform-sent invitations at two levels: the **tenant** setting
`invitation_channel ∈ allowed | forbidden` is the *legal envelope*, Owner-only, platform default
`forbidden` for tenants whose billing country is Germany; the **campaign** setting
`invitations_enabled` is the product choice and "can never enable what the tenant forbids".

The tenant half was absent — and so was its input: **no column anywhere in this service held a
country**. So the rule could not even be computed, let alone enforced.

Two columns, one migration (`20261022070000_tenant_invitation_channel`, applied):

| column | why |
|---|---|
| `billing_country char(2)` | the jurisdiction input the rule names, which nothing held |
| `invitation_channel varchar(20)` nullable, CHECK `('allowed','forbidden')` | the Owner's choice |

**Null means "the Owner has not chosen"** and resolves through `effectiveInvitationChannel()` to the
platform default. Storing the derived value instead would freeze a jurisdiction answer at
provisioning and lose the distinction between *not chosen* and *chosen `allowed`* — and R-PRT-02's
own example turns on that distinction ("If Globex's Owner later sets the tenant to forbidden, every
campaign drops to mailto: at its next widget-config fetch").

*Rejected:* putting it in `tenant_settings.general`, which is a Json blob holding branding and
locale. A legal gate that another service must read on every widget-config fetch deserves a column
with a CHECK constraint, not a key in free-form JSON.

*Rejected:* defaulting to `forbidden` when the country is unknown. The country is not known at
provisioning, so that would switch the feature off platform-wide until every tenant was corrected.
R-PRT-02 names Germany, not "unknown".

**Owner-only, enforced twice.** The endpoint is gated on `tenants:write`, which the custom `admin`
role also holds — the role R-ACT-01 says does not exist (§V5.21 open item 2). A jurisdiction gate
whose misuse creates liability under German competition law gets the belt as well as the braces, so
`TenantService.assertOwner` additionally requires the principal to hold **every** relation in the
catalog. "Is the Owner" is not a field on `IAuthenticatedUser` — §4's model is relations and the
Owner is the role granted all of them — and comparing against `ALL_PERMISSIONS` says exactly that
while staying correct as the catalog grows. Naming two sample Owner-only relations instead would
quietly stop meaning "Owner" the moment another role gained them.

**Who reads it.** `GET /v1/internal/tenants/{id}/profile` now carries the *effective* value, resolved
here so no consumer re-derives the jurisdiction rule. Referral Workflow checks it before creating an
Invitation; widget-config uses it to decide whether `invite_email` is among the share tools
(R-SDK-03). Written up as a cross-service requirement, since both callers are other services.

### A5-17 · Two relations missing from the Campaign Manager

§4's permission table gives the Campaign Manager `programs | read` and
`referrers | read · write · block`; `ROLE_GRANTS[OPERATOR]` had neither `programs:read` nor
`referrers:block`. The second is the one that mattered: a fraudulent participant was only blockable
by the Owner, when the person watching the campaign is exactly who should be able to stop them.
The parity spec that holds `ROLE_GRANTS` against §4 did not catch it because its expected array was
written from the same reading as the code.

### Verified

| claim | how |
|---|---|
| DE defaults to forbidden, FR/ES/NL to allowed, unknown to allowed | `invitation-channel.spec.ts`, both casings |
| an explicit choice beats the default in both directions | same suite |
| a stored value outside the enum falls back to the default | same suite |
| the internal profile carries the effective value | `controllers.spec.ts` — a DE tenant with no choice reads `forbidden` |
| the two grants match §4 | the authz parity spec's Operator row |
| unit suite | **589 passed / 56 suites** (was 581) |
| typecheck | 27 errors, unchanged baseline; `nest build` clean |

Not verified live: no caller reads the invitation channel yet, because Referral Workflow is not in
this working set.

### Left alone, deliberately

- **`POST /v1/dsr` stays on `dsr:manage`.** §4's table routes it to `programs:write` (Owner only) and
  §3.15's to `referrers:write`; neither is about data-subject requests, and §V5.16 D5-11 already
  ratified the separate relation. The spec's own disagreement is CHANGELOG D-09.
- **17 namespaces against §4's "eleven".** The extras — `dsr`, `connections`, `tenants`, `users`,
  `billing`, `audit` — all carry endpoints §13 assigns to Identity & Access that §4's table simply
  does not cover. Worth ratifying rather than changing.

## V5.21 `admin` is gone — T-1 reversed, with the migration T-1 was missing (2026-10-22)

R-ACT-01: *"There are exactly five internal roles: Owner, Campaign Manager, Analyst, Support Agent
(tenant-side, Keto roles `owner` / `operator` / `viewer` / `support`) and Super Admin (platform-side).
**No other role exists**; 'Program Admin', 'Account Owner', 'Marketer/Operator' and 'Viewer' are
retired names for the same four tenant roles."*

`ADMIN` was the retired Program Admin. **Decision T-1 kept it** as a custom role, and its stated
reason was sound at the time: *"removing a role that may be assigned to live users would orphan them
mid-session"*, and v5's own `roles.name` CHECK permits `custom`. Reversed now, because the objection
was never to the removal — it was to removing it **without moving its holders**. That is a migration,
and T-1 did not write one.

### What it took

| | |
|---|---|
| enum | `RoleEnum` is four values; `CUSTOM_ROLES` deleted with nothing left to hold |
| grants | the `ADMIN` row of `ROLE_GRANTS` and its rank 4 are gone, and `withoutNamespaces()` with them — it existed only to build that one grant |
| ownership transfer | the outgoing Owner becomes an **`OPERATOR`**, the highest standard role below Owner. T-1's second reason for keeping `ADMIN` was exactly this path |
| `PRIVILEGED_ROLES` | `[OWNER]`. `remove()` refuses an Owner two lines earlier, so the last-privileged-member check there was dead and is gone; `updateRole()` keeps it for a demotion |
| migration | `20261022080000_retire_admin_role` |
| seed | the catalog description |
| DTO | `ContactDto.role`'s documented enum said `owner, admin, operator, viewer` — wrong in two ways, since it also omitted `support` |

### The migration remaps **down**, never up

`ADMIN` granted every namespace except billing, with tenant deletion reserved to the Owner. Holders
become `OPERATOR` (Campaign Manager), the highest standard role below Owner — not Owner, which would
hand a former admin billing and tenant deletion. **A migration must never escalate a privilege.**
Anyone who should hold more can be promoted deliberately afterwards, by a person, with an audit entry.

It also moves `invitations` still offering the role, repoints the `user_roles` display projection
(dropping rather than repointing a row that would collide on `(user_id, role_id)` because the member
already holds `OPERATOR`), and then **refuses to continue** if anything still references the role.
That last step matters: `user_roles.role_id` cascades on delete, so a missing `OPERATOR` catalog row
would have turned the final `DELETE FROM roles` into a silent deletion of live assignments instead of
a move. Forward-only, with no down migration — re-creating the role would not restore who held it.

**Applied and verified live, 2026-10-22.** The dev database held no `ADMIN` at all, so applying it
as-is would have proved only that the SQL parses. Both cases the migration exists for were seeded
first — a plain holder, and a member holding **both** `ADMIN` and `OPERATOR`, which is the
`(user_id, role_id)` collision — and then:

| | before | after |
|---|---|---|
| `users.role = 'ADMIN'` | 2 | 0, both `OPERATOR` |
| the plain holder's `user_roles` row | → `ADMIN` | → `OPERATOR` |
| the double holder's `user_roles` rows | `ADMIN` + `OPERATOR` | one `OPERATOR` — the colliding row dropped, not duplicated, no PK violation |
| `invitations.role = 'ADMIN'` | 1 | 0, `OPERATOR` |
| the `roles` catalog | ADMIN · OPERATOR · OWNER · VIEWER | OPERATOR · OWNER · VIEWER |

The guard block passed with zero remaining references, so the `DELETE FROM roles` ran as a delete and
not as a cascade. Fixtures were prefixed `01JMIGTEST` and removed afterwards; the database is back to
its one real Owner.

**Noticed while in there, not fixed:** the `roles` catalog has no `SUPPORT` row, although `seed.ts`
upserts all four standard roles. The seed has not been re-run since `SUPPORT` was added, so a tenant
assigning a Support Agent today would hit `replaceRoleProjection`'s "Role catalog is missing SUPPORT —
run the seed". One `pnpm prisma:seed`, but it is a data fix rather than a code one.

### A side effect: the `roles.tenant_id` gap closes itself

§V5.5's schema list, item 2, wanted `roles.tenant_id` — null for the four standard roles, set for
custom ones — because "decision T-1 keeps `ADMIN` as a custom role, and v5 scopes custom roles to a
tenant; without the column `ADMIN` is a global row, which is the one part of T-1 the schema cannot
yet express." There are no custom roles now, so the column has nothing left to express. Item 2 should
be struck rather than built.

### The Owner-only re-check in `tenant.service.ts` is gone

`assertOwner()` existed for one reason, which its own comment stated: `tenants:write`, the relation
gating `PATCH /v1/tenants/me`, *"is also held by the custom `admin` role v5 does not define"*. R-PRT-02
makes the invitation channel Owner-only, so the guard alone was not enough. With `admin` retired,
`tenants:write` belongs to the Owner and nobody else — the guard **is** the enforcement.

**The residual risk, stated plainly:** the gate is now a property of `ROLE_GRANTS`, not of the
endpoint. If any future role is given `tenants:write`, it silently gains the ability to set a
jurisdiction flag whose misuse creates liability under German competition law. The authz parity spec
asserts the four grants against §4, which is what would catch it — but it would catch it as a spec
mismatch, not as "someone can now change the invitation channel". Worth a line in whatever review
adds a fifth role.

### Verified

| claim | how |
|---|---|
| four roles, nothing else | `authz.spec.ts` asserts `Object.keys(ROLE_GRANTS)` is exactly the four |
| transfer leaves the outgoing Owner an Operator | `users.service.spec.ts`, on both the row and the event |
| the Owner still cannot be removed | `users.service.spec.ts`, from both directions — see below |
| unit suite | **589 passed / 56 suites**, the same count as before |
| typecheck | 27 errors, unchanged baseline |
| lint | `npx eslint src test` — **0 errors** (117 warnings, all pre-existing `any`s) |

The removal test changed shape. It used to seed an `ADMIN`, stub the privileged count at 1 and expect
`409`. The surviving invariant is enforced one layer up: `RoleGrantPolicy` refuses an Owner acting on
their own membership, and refuses anyone else from managing a peer or superior — so the Owner is
unreachable from both directions with `403`, and `remove()`'s `state_conflict` branch is defensive
code that predates this change. The test now asserts the reachable behaviour and says so.

### Two things found while here, not fixed

- **The BDD suite does not compile**, and did not before this change:
  `src/features/webhook/webhook.controller.ts(88,46): Property 'rawBody' does not exist on type 'Request'`.
  `tsc --noEmit` does not report it, so the Cucumber runner is resolving a different `tsconfig` — one
  without whatever augments Express's `Request`. Nothing in this change touches that file.
- **Three files from earlier in this session had no trailing newline** and one had a double blank
  line, all four committed, all four failing `prettier/prettier` — so `pnpm lint:check` was red on
  `main` for `contact.dto.ts`, `tenant.service.ts`, `operator-contact.controller.ts` and
  `tenant.types.ts`. Fixed in this commit. Cause: `Path.write_text` on Windows, which also silently
  rewrote those files CRLF; git's `core.autocrlf=input` normalized the blobs, so neither the diffs
  nor the test suite ever showed it. Lint was the only thing that did.

---

> **Cross-service decision list.** The consolidated list of everything still open across all four
> services — the three blockers and their dependency chain, the decisions already taken, the
> ratifications, and the spec defects — lives in `referral-pulse-event-svc/NOTE.md` §11. This
> service's own detail stays above.
