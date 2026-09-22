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
