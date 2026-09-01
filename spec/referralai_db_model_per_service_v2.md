# ReferralAI — Database Model per Microservice

**Status:** Implementation-ready model — refines and supersedes the *Database Tables per Microservice* working hypothesis
**Derived from (ground truth):** System Architecture v1.3 · Product Spec v4.0 · API Contract v1.3 · Event Model v3.0 · Responsibility Contract v3.0 · Failure & Observability Model v3.0
**Date:** June 2026
**Audience:** 2-senior-engineer build team

---

## 0. Conventions (apply to every table)

These rules hold platform-wide and are not repeated per table.

### 0.1 Identifiers — ULID single-key model (one id: PK + business + wire)

Every table has **one** identifier, the app-generated ULID, and it plays every role: physical primary key, business id, and the id on the wire. There is **no** separate DB-generated `bigint` surrogate.

- **`id` — the identifier, app-generated ULID.** `char(26) PRIMARY KEY` (`@default(ulid())`), Crockford Base32, time-ordered, assigned in domain code before persistence. It is the clustered `PRIMARY KEY`, the target of every *intra-service* foreign key, **and** the only id that appears in the public API, the event envelope (`event_id`), and any cross-service reference.
- **Accepted trade-off.** A 26-char string PK is wider than an 8-byte `bigint` and string-compared on joins, so secondary indexes carry more and joins cost a little more — a real but bounded latency cost. The platform accepts it in exchange for **one id everywhere**: no surrogate to generate, map, or accidentally leak, and no ULID↔bigint translation layer (KISS > micro-optimization). ULID is time-ordered, so inserts still append rather than page-split — the worst B-tree fragmentation is avoided.

**Reading convention for the rest of this document:**
- A table's **"Primary Key: (`id`)"** line and "`id` … ULID, PK" in a column list both mean exactly that: the ULID `id` **is** the physical `PRIMARY KEY` (`char(26)`, app-generated). There is no hidden surrogate underneath.
- A column marked **local FK** is a `char(26)` referencing the parent's `id` (ULID) with a real DB `FOREIGN KEY`, using the logical `<entity>_id` name in the column list.
- **Cross-service references** (`campaign_id`, `participant_id`, `reward_id`, …) carry the same `id` ULID by value as `char(26)`, validated in service logic — never a DB `FOREIGN KEY`, since another service's rows are not local.
- Pure lookup/junction tables key on their **natural composite key** (e.g. `idempotency_keys`, `cap_ledgers`, `user_roles`) and need no separate `id`; those say so.

### 0.2 Standard columns

Unless a table is explicitly append-only, every table carries:

| Column | Type | Notes |
|--------|------|-------|
| `id` | char(26) | app-generated ULID (`@default(ulid())`); the physical `PRIMARY KEY` **and** the business id used in the API, events, and cross-service refs |
| `tenant_id` | text | ULID, not null on all tenant-scoped tables; first column of nearly every composite index. Platform-level tables (`playbooks`, platform `notification_templates`, platform `fraud_rules`) allow `tenant_id` null. |
| `created_at` | timestamptz | not null, set by app |
| `updated_at` | timestamptz | not null, bumped on every mutation |

Append-only tables (`touches`, `*_events`, ledgers, audit, decision logs) carry `id`, `tenant_id`, and a single occurrence timestamp instead of `updated_at`; they are never `UPDATE`d or `DELETE`d.

### 0.3 Enums

Enum-valued columns are modeled as **`text` + a `CHECK` constraint** (not native PG `ENUM`), because Event Model v3.0 §8.2 treats *adding an enum value* as a non-breaking additive change — and `text`+`CHECK` evolves with a cheap constraint swap, whereas `ALTER TYPE … ADD VALUE` cannot run in a transaction and cannot remove values. Allowed values are listed per column.

### 0.4 Soft delete & lifecycle

- Programs, Campaigns, Segments, Webhook endpoints, API keys use **soft delete** (`archived_at` / `revoked_at` / `disabled_at` / `deleted_at` timestamptz, null = live). Hard `DELETE` is reserved for GDPR erasure tooling only.
- Events, touches, ledgers, decision logs, and audit rows are **append-only and immutable** (Event Model §1.4). Correction = a new compensating row, never an edit.

### 0.5 Auditability

Sensitive rows (clawbacks, reversals, manual approvals/rejections, blocks, trust changes, payout confirms, fraud verdicts, erasure) carry `created_by` (operator ULID or `system`), and where a reason is mandated by the contract, a non-null `reason`. A dedicated `audit_log` table exists in `tenant_db` as the platform-wide operator-action trail (API Contract §8.3: *"Audit trail: tenant lifetime + 12 months"*).

### 0.6 Reliable event emission — transactional outbox

Every service that **emits domain events** writes them to a local `event_outbox` table **in the same transaction** as the state change, and a relay publishes them to SNS/SQS at-least-once. This is what makes Failure Model §4 ("an acknowledged event is eventually processed") true without 2-phase commit. The shape is identical everywhere, defined once here and referenced per service:

**Table:** `event_outbox`
**Purpose:** Durable buffer of domain events awaiting publication to the bus.
**Primary Key:** (`id`) — ULID; this *is* the event envelope `event_id`.
**Columns:**
- `id` — text (ULID = `event_id`), PK.
- `tenant_id` — text, not null.
- `event_type` — text, not null (e.g. `reward.approved`).
- `external_id` — text, not null. Deterministic dedup key (Event Model §2.1) — for domain events derived from a domain fact (e.g. `reward.approved:{reward_id}`).
- `schema_version` — smallint, not null, default 1.
- `aggregate_type` — text (e.g. `reward`).
- `aggregate_id` — text — the row that produced it.
- `payload` — jsonb, not null. Full canonical envelope (`source`, `actor`, `object`, `attribution_context`, `properties`).
- `status` — text, `CHECK in ('pending','published','failed')`, default `pending`.
- `attempt_count` — smallint, default 0.
- `occurred_at` — timestamptz, not null.
- `published_at` — timestamptz, null until relayed.
- `created_at` — timestamptz, not null.

**Unique Constraints:** (`tenant_id`, `event_type`, `external_id`) — guards double emission on retry/replay.
**Indexes:** `idx_outbox_pending` on (`status`, `created_at`) `WHERE status = 'pending'` (partial — the relay's hot path).
**Notes:** Append-then-mark; rows are retained ~7 days after `published`, then pruned. The bus is at-least-once and out-of-order (API Contract §6.3), so the `external_id` uniqueness here plus consumer-side idempotency are what prevent double-processing.

### 0.7 Request idempotency (non-ingestion mutations)

API Contract §1 Idempotency: all non-ingestion `POST`/`PATCH` require an `Idempotency-Key` header, deduped **per tenant + per key for 24 h**, returning the *original stored response* on replay. Each service exposing mutating endpoints owns an `idempotency_keys` table (defined once, referenced per service):

**Table:** `idempotency_keys`
**Primary Key:** (`tenant_id`, `idempotency_key`)
**Columns:** `tenant_id` text; `idempotency_key` text; `request_fingerprint` char(64) (SHA-256 of method+path+body, to detect key reuse with a different body → `409`); `response_status` smallint; `response_body` jsonb; `target_resource_id` text (the ULID created); `created_at` timestamptz; `expires_at` timestamptz (`created_at + 24h`).
**Indexes:** `idx_idem_expiry` on (`expires_at`) for the TTL sweeper.
**Notes:** Distinct from ingestion dedup (which is Redis-only, per tenant + `external_id`, 90-day — see §4). The two regimes never share an identifier (Responsibility Contract §4.1).

---

## 1. Reconciliation Decisions (deltas vs the working doc)

The working hypothesis was written against the older v2.x/v3.2 docs. These are the substantive changes made to align with v1.3 / v4.0 / v3.0, each flagged inline where it applies.

| # | Revised Decision | Rationale |
|---|------------------|-----------|
| R1 | **`identity_db` → `tenant_db`**; service renamed `identity-service` → `tenant-service`. Ory (Kratos/Keto/Hydra) tables are treated as **external but colocated** in the same RDS cluster and are not counted. | System Architecture v1.3 service list names `tenant-service`. |
| R2 | **ClickHouse removed entirely** from this document — `analytics_db` is PostgreSQL-only. The four OLAP tables/views from the working doc are explicitly **out of scope** (separate document). | Task scope: "Do NOT define ClickHouse schemas." |
| R3 | **`referral_code_registry` deleted from `campaign_db`.** `referral_db.referral_links` is the single authoritative `referral_code → campaign/variant/participant` map; ingestion resolves codes from a **Redis mirror** of it. | The Referral Workflow Service generates links (`link.generated`, Event Model §5.4) and owns the code. A second registry in `campaign_db` would be a cross-service duplicate with no owner. |
| R4 | **Reward `status` reconciled to a single superset enum** with an explicit mapping across the three docs (Product Spec §8 / API §3.8 use *Pending→Held→Approved→Processing→Paid*; Event Model §5.2 uses *earned→pending_approval→approved→processing→paid* (branches *rejected*/*reversed*)). A first-class **`held`** state is added. See §6, table `rewards`. | API §3.8 and the Pulse saga (Product §6 step 7: *approve \| HOLD \| reject*) require `Held`; the working doc lacked it. |
| R5 | **`trust_tier` enum = `unknown / new / trusted / ambassador`** (the wire contract from Event Model `participant.trust_tier_changed`). The Product Spec §7 bands (*New/Established/Trusted/Advocate*, 0–25/26–50/51–75/76–100) are stored as the **numeric `trust_score`** (source of truth) plus a derived `trust_band` column for the payout-limit/hold lookup. | The two docs disagree on tier names; the event enum is what crosses the bus, the numeric score is what the model computes. Storing both removes ambiguity. |
| R6 | **`participants` stays in `referral_db`** (not split into `tenant_db`). Participant state/trust **domain events are emitted from `referral_db`** via its outbox. | Participants are external advocates with **no platform login** (Product §7) — they are a referral-domain aggregate, not an identity/access (operator) aggregate. Trust inputs (success rate, conversion quality) are all local to `referral_db`. Event Model §5.3's "produced by Identity & Access / Program & Campaign" is noted as a doc imprecision; placement follows the working doc and data locality. |
| R7 | Added platform plumbing the working doc omitted: per-service **`event_outbox`** (§0.6), **`idempotency_keys`** (§0.7), **`temporal_workflow_id` + `temporal_run_id`** on workflow-backed aggregates, **`schema_version`** on event-bearing tables, **`event_outbox`**-fed inbound-receiver and ledger tables. | Failure & Observability Model §4 (DLQ/replay/reconciliation) and Temporal durability (Product §6) require these to be persisted. |
| R8 | **ULID single-key model** — the ULID `id` (`char(26)`, app-generated) is the physical `PRIMARY KEY`, the business id, and the wire id, all in one. **No** DB-generated `bigint` surrogate. This **supersedes the earlier dual-key/bigint-`pk` variant** of R8 (which had itself reversed the original "no DB-generated IDs" rule). See §0.1. | Decision (2026-07): one id everywhere beats the surrogate's latency win. The `bigint` PK is faster (dense indexes, integer joins) but forces a second key to generate, map ULID↔bigint, and never leak — complexity in every write path and mapper. The team accepts the bounded ULID-PK cost (wider key, string compare; mitigated by ULID being time-ordered, so inserts still append) to keep a single opaque, externally-safe identifier and delete the translation layer (KISS > micro-optimization). |
| R9 | **Enrollment is `selective` only, platform-wide.** The `open` value and the §4.2 self-enrollment flow are being **removed from API Contract v1.3** to match Product Spec v4; the data model carries `enrollment_model CHECK in ('selective')` with no self-enrollment path. Also: **one live Program per tenant** is enforced via `UNIQUE(programs.tenant_id) WHERE archived_at IS NULL`; and the campaign terminal state is **`ended`** (Product §6) while the public webhook stays **`campaign.completed`** (API §6, an intentional internal-state vs public-event split). | Product Spec v4.3 §2 & §7 states selective-enrollment and one-Program-per-client as *immutable* constraints. With `open`/self-enrollment struck from the API contract, all specs now agree; the single-value `enrollment_model` column is retained to document the constraint explicitly and leave room if the model is ever re-expanded. |

---

## 2. Per-Service Overview

| # | Service (v1.3) | DB | Redis? | Emits domain events? |
|---|----------------|-----|--------|----------------------|
| 1 | `tenant-service` (Tenant / Identity & Access) | `tenant_db` (+ colocated Ory) | Sessions, Keto decision cache | yes |
| 2 | `campaign-service` (Program & Campaign) | `campaign_db` | active-campaign + budget projection | yes |
| 3 | `segmentation-service` (Segmentation & Eligibility) | `segmentation_db` | eligibility + variant-assignment cache | yes |
| 4 | `ingestion-service` (Event Ingestion) | **none** | dedup, rate-limit, campaign cache, touch dedup, session map | publishes tracked events (no outbox — Redis dedup is the guard) |
| 5 | `referral-service` (Referral Workflow & Attribution) | `referral_db` | hot referral state, session→referee map, code mirror, velocity counters | yes |
| 6 | `reward-service` (Reward & Payout) | `reward_db` | cap counters (atomic) | yes |
| 7 | `analytics-service` (Analytics) | `analytics_db` (PostgreSQL only — ClickHouse out of scope, R2) | real-time KPI counters | no (read/compute) |
| 8 | `notification-service` (Notification & Webhook) | `notification_db` | delivery in-flight locks, endpoint health | yes (delivery domain events optional) |
| 9 | `ai-service` (AI Intelligence) | `ai_db` | inference cache, event dedup | yes (recommendation/fraud signals) |

---

## 3. `tenant-service` — `tenant_db`

**Responsibilities (v1.3):** tenant accounts, operator users & roles, API keys, OAuth2 clients, sessions, company verification, platform audit trail. Wraps Ory Kratos (credentials/sessions), Keto (permissions), Hydra (OAuth2 clients). **Aggregates:** Tenant, User, ApiKey, Verification.
**Redis:** session lookup cache; short-TTL Keto permission-decision cache.
**Emits:** `tenant.*`, operator-driven `participant.state_changed`/`participant.trust_tier_changed` only when an operator action triggers them (the trust *computation* lives in `referral_db`, R6).

> **Revised Decision (R1):** `identity_db` → `tenant_db`. Ory-managed tables (Kratos identities & credentials, Keto relation tuples, Hydra clients/consent) live in the same RDS cluster but follow Ory's own schema and are excluded from the table count.

**Table:** `tenants`
**Purpose:** Client account; tenant-isolation root. Exactly one live Program per tenant (Product Spec v4 immutable constraint), enforced by a unique index on `programs.tenant_id` in `campaign_db`.
**Primary Key:** (`id`)
**Unique:** (`slug`) where non-null.
**Columns:**
- `id` text (ULID) PK · `name` text not null · `slug` text · `plan` text `CHECK in ('free','starter','growth','scale','enterprise')` · `status` text `CHECK in ('active','suspended','closed')` not null · `verification_status` text `CHECK in ('unverified','pending','verified','rejected')` not null default `unverified` · `data_region` text not null default `eu-central-1` (Product §12 EU-first) · `retention_months` smallint not null default 24 `CHECK between 6 and 36` (API §8.3) · `metadata` jsonb · `created_at` · `updated_at` · `archived_at` timestamptz null.
**Indexes:** `idx_tenants_status` (`status`).
**Notes:** `verification_status` is driven by the `tenant_verifications` workflow below.

**Table:** `users`
**Purpose:** Platform operator accounts (admins, marketers, analysts, support). Not participants.
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `email`); (`kratos_identity_id`).
**Columns:**
- `id` text PK · `tenant_id` text not null · `email` text not null · `email_hash` char(64) · `name` text · `kratos_identity_id` text (Ory owns credentials) · `status` text `CHECK in ('invited','active','disabled')` not null · `last_login_at` timestamptz · `created_at` · `updated_at` · `disabled_at` timestamptz null.
**Indexes:** `idx_users_tenant` (`tenant_id`).
**Notes:** Authorization is **not** stored here — it lives in Ory Keto relation tuples (API §2). `roles`/`user_roles` below are a **projection** for dashboard display and bulk assignment, not the authoritative permission store.

**Table:** `roles`
**Purpose:** Human-readable role catalog mapped to Keto group memberships.
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `name`) — `tenant_id` null for the four platform-standard roles.
**Columns:** `id` · `tenant_id` text null · `name` text `CHECK in ('owner','admin','operator','viewer')` or custom · `description` text · `keto_relations` jsonb (the relation set this role grants, e.g. `["campaigns:write","rewards:approve"]`) · `created_at` · `updated_at`.

**Table:** `user_roles`
**Purpose:** Operator→role assignment projection (authoritative copy is Keto).
**Primary Key:** (`user_id`, `role_id`) — both **local FK** to `users.id` / `roles.id`.
**Columns:** `user_id` · `role_id` · `tenant_id` · `assigned_at` timestamptz · `assigned_by` text (operator ULID).
**Indexes:** `idx_user_roles_tenant` (`tenant_id`).

**Table:** `api_keys`
**Purpose:** Ingestion & SDK API keys (API §2 — these *cannot* reach config endpoints).
**Primary Key:** (`id`)
**Unique:** (`key_hash`); (`tenant_id`, `key_prefix`).
**Columns:**
- `id` text PK · `tenant_id` text not null · `key_hash` text not null (bcrypt/argon2 of full key) · `key_prefix` char(4) not null (last 4 chars — the *only* part ever shown in logs/dashboards, API §8.3) · `key_type` text `CHECK in ('secret','publishable')` not null (prefixes `rai_live_` / `rai_pub_`) · `label` text · `keto_scope_note` text · `created_by` text not null · `last_used_at` timestamptz · `created_at` · `revoked_at` timestamptz null.
**Indexes:** `idx_api_keys_tenant_active` (`tenant_id`) `WHERE revoked_at IS NULL`.
**Notes:** Full key returned **once** at creation, never stored in plaintext. `key_type` gates trust at ingestion (Event Model §3.3: publishable = touch-only, `low` trust).

**Table:** `oauth2_clients`
**Purpose:** OAuth2 client registrations (dashboard SPA, machine clients). Mirrors/augments Ory Hydra.
**Primary Key:** (`id`)
**Unique:** (`client_id`).
**Columns:** `id` · `tenant_id` · `client_id` text not null · `client_secret_hash` text · `redirect_uris` jsonb (array) · `grant_types` jsonb (array) · `client_type` text `CHECK in ('dashboard_spa','client_credentials')` · `created_at` · `updated_at` · `revoked_at`.

**Table:** `sessions`
**Purpose:** Active dashboard session index (Ory Kratos authoritative; this is a fast local lookup + revocation list).
**Primary Key:** (`id`)
**Columns:** `id` · `user_id` (**local FK**) · `tenant_id` · `token_hash` char(64) not null · `ip_hash` char(64) · `user_agent` text · `expires_at` timestamptz not null · `created_at` · `revoked_at`.
**Indexes:** `idx_sessions_token` (`token_hash`); `idx_sessions_expiry` (`expires_at`).
**Notes:** Mirrored to Redis (§3 Redis) for sub-ms validation; Postgres is the durable/recoverable copy.

**Table:** `tenant_verifications`
**Purpose:** Company (KYB) verification workflow backing `tenants.verification_status`.
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `verification_type` text `CHECK in ('company','tax','payout_provider')` · `status` text `CHECK in ('pending','in_review','verified','rejected')` not null · `evidence` jsonb (uploaded-doc references, never raw docs) · `temporal_workflow_id` text · `temporal_run_id` text · `reviewed_by` text · `reviewed_at` timestamptz · `reason` text · `created_at` · `updated_at`.
**Indexes:** `idx_verif_tenant` (`tenant_id`, `status`).
**Notes:** `temporal_workflow_id`/`run_id` added (R7) so a crashed verification workflow is resumable.

**Table:** `audit_log` *(append-only)*
**Purpose:** Platform-wide operator-action trail (API §8.3: tenant lifetime + 12 months, dashboard-only).
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `actor_user_id` text not null · `action` text not null (e.g. `api_key.revoked`, `user.role_changed`) · `target_type` text · `target_id` text · `reason` text · `request_id` text (the `X-Request-Id`, ties to logs) · `ip_hash` char(64) · `before` jsonb · `after` jsonb · `occurred_at` timestamptz not null.
**Indexes:** `idx_audit_tenant_time` (`tenant_id`, `occurred_at` desc); `idx_audit_target` (`tenant_id`, `target_type`, `target_id`).

**Plus:** `event_outbox` (§0.6), `idempotency_keys` (§0.7).

### `tenant-service` Redis

| Key pattern | Value | TTL | Authoritative store | Recompute if lost? | Concurrency |
|---|---|---|---|---|---|
| `session:{tenant_id}:{token_hash}` | JSON `{user_id, exp, roles}` | = session exp | `sessions` + Ory Kratos | Yes (rehydrate from Postgres/Kratos) | plain `SET` |
| `keto:decision:{user_id}:{relation}:{object}` | `"allow"`/`"deny"` | 30–60 s | Ory Keto | Yes (re-query Keto) | plain `SET`; short TTL bounds staleness after a role change |
| `apikey:{key_prefix}:{key_hash8}` | JSON `{tenant_id,key_type,key_id,revoked}` | 300 s | `api_keys` | Yes | invalidated on revoke |

---

## 4. `campaign-service` — `campaign_db`

**Responsibilities (v1.3):** program lifecycle, campaign CRUD + state machine, variant configuration, pulses, playbooks. **Aggregates:** Program, Campaign, Variant, Pulse, Playbook.
**Redis:** active-campaign flag for the ingestion guard; budget-spend projection counter.
**Emits:** `campaign.activated/paused/completed/budget_threshold`, `program.*`, `variant.*`.

> **Revised Decision (R3):** `referral_code_registry` is removed from this DB. Code resolution is owned by `referral_db.referral_links` and served to ingestion via a Redis mirror.

**Table:** `programs`
**Purpose:** Top-level container; carries default attribution policy. Soft-delete cascades to campaigns (API §3.1).
**Primary Key:** (`id`)
**Unique:** (`tenant_id`) `WHERE archived_at IS NULL` — **one live Program per tenant** (Product Spec v4 immutable constraint: one Program per client).
**Columns:**
- `id` · `tenant_id` not null · `name` text not null · `description` text · `status` text `CHECK in ('active','archived')` not null default `active` · `default_attribution_model` text `CHECK in ('first_touch','last_touch','multi_touch_linear','ai_weighted')` not null default `last_touch` · `default_attribution_window_days` smallint not null default 30 · `health_score` smallint null (0–100, computed by `analytics-service`, projected here for the `GET /programs/{id}/health` read) · `health_computed_at` timestamptz · `metadata` jsonb · `created_at` · `updated_at` · `archived_at`.
**Indexes:** `idx_programs_tenant` (`tenant_id`) `WHERE archived_at IS NULL`.

**Table:** `campaigns`
**Purpose:** Time-bound execution unit; selects an immutable Pulse, holds shared budget, runs the state machine (Product §6, API §3.2).
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `slug`).
**Columns:**
- `id` · `program_id` (**local FK**) · `tenant_id` not null · `name` text not null · `slug` text not null · `pulse_type` text `CHECK in ('signup','conversion','reactivation','cross_sell','renewal','feedback','newsletter','switch_up','product_education')` not null **(immutable after create)** · `pulse_id` text (**local FK** → `pulses`) · `status` text `CHECK in ('draft','scheduled','active','paused','ended','archived')` not null default `draft` · `enrollment_model` text `CHECK in ('selective')` not null default `selective` · `starts_at` timestamptz · `ends_at` timestamptz · `attribution_window_days` smallint · `budget_amount` bigint (minor units) · `budget_currency` char(3) · `spent_amount` bigint not null default 0 (**cached projection** — authoritative spend = Σ rewards in `reward_db`; updated on `reward.*` events and reconciled by the Reward-to-Referral job, Failure §4.3) · `auto_paused_at` timestamptz null (set when `spent_amount ≥ budget_amount`) · `metadata` jsonb · `created_at` · `updated_at` · `archived_at`.
**Indexes:** `idx_campaigns_program` (`program_id`); `idx_campaigns_tenant_status` (`tenant_id`, `status`).
**Notes:** State machine transitions are guarded in app; each emits the matching `campaign.*` domain event via outbox. `spent_amount`/`auto_paused_at` back the budget auto-pause (API §3.2) and the ingestion guard's "campaign paused" branch. The terminal state is **`ended`** to match the Product Spec v4.3 §6 vocabulary (Draft → Scheduled → Active → Paused → Ended → Archived); the corresponding **public webhook event remains `campaign.completed`** (API §6) — an intentional internal-state vs public-event split, like rewards. `enrollment_model` is **`selective` only**: Product Spec v4.3 §2/§7 makes selective enrollment an immutable constraint (no self-enrollment widget path), and the `open` value plus §4.2 self-enrollment flow are being removed from the API contract — so selective-only is consistent across all specs (see R9).

**Table:** `variants`
**Purpose:** Binds Segment (who) + Reward Config (what) + messaging + allocation weight. The core config unit (API §3.3).
**Primary Key:** (`id`)
**Unique:** partial unique `(campaign_id) WHERE is_default` → at most one default variant per campaign.
**Columns:**
- `id` · `campaign_id` (**local FK**) · `tenant_id` not null · `name` text · `is_default` boolean not null default false · `priority` smallint not null default 0 (resolution order) · `allocation_weight` smallint not null default 100 · `segment_id` text null (reference into `segmentation_db`) · `inline_segment_rules` jsonb null · `reward_config` jsonb not null (Reward Configuration schema, API §3.3 — reward_type, amount/percentage, caps, recipient split, cooling period) · `messaging` jsonb · `eligibility_rules` jsonb (array of rule refs/inline) · `approval_mode` text `CHECK in ('auto','manual','auto_below_threshold','ai_assisted')` not null · `enabled` boolean not null default true · `created_at` · `updated_at`.
**Indexes:** `idx_variants_campaign` (`campaign_id`, `priority`).
**Notes:** Variant is resolved **at enrollment** (Product §6, Responsibility §3) — the resolved `variant_id` is then stored on the participant's enrollment and link in `referral_db`. `reward_config` is read by `reward-service` at reward calculation; it is referenced by value (no cross-DB FK).

**Table:** `pulses`
**Purpose:** Reusable Temporal workflow template definition for a pulse type.
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` null (platform-default pulses allowed) · `name` text · `pulse_type` text (same CHECK set as `campaigns.pulse_type`) · `trigger_event_type` text (e.g. `conversion.payment_completed`) · `conversion_event_type` text · `default_window_days` smallint · `workflow_definition` jsonb (saga step config — fraud gate, eligibility checkpoints, wait timer, reward formula, hold) · `temporal_task_queue` text · `created_at` · `updated_at`.
**Notes:** `workflow_definition` encodes the shared Pulse skeleton (Product §6) with the per-pulse trigger/formula swap.

**Table:** `playbooks`
**Purpose:** Vertical-specific curated bundles (platform-level, not tenant-scoped). Read-only catalog; instantiated into a draft Campaign (API §3.11).
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` null (platform catalog) · `name` text not null · `vertical` text `CHECK in ('b2b_saas','agency','creator','ai_tool','ecommerce','fintech')` · `default_pulse_type` text · `recommended_pulses` jsonb · `default_reward_config` jsonb · `default_messaging` jsonb · `default_segment_strategy` jsonb · `is_active` boolean not null default true · `created_at` · `updated_at`.
**Notes:** Playbooks are curated by the team, not AI (Product §6); the AI only *recommends* which playbook fits.

**Plus:** `event_outbox` (§0.6), `idempotency_keys` (§0.7).

### `campaign-service` Redis

| Key pattern | Value | TTL | Authoritative | Recompute if lost? | Concurrency |
|---|---|---|---|---|---|
| `campaign:active:{tenant_id}:{campaign_id}` | JSON `{status,starts_at,ends_at,enrollment_model}` | none (explicit invalidation on `campaign.*`) | `campaigns` | Yes | `SET` on state change |
| `campaign:spend:{campaign_id}` | integer (minor units) | none | `reward_db` (Σ rewards) → projected to `campaigns.spent_amount` | Yes (recompute from reward ledger) | `INCRBY` on reward events; budget auto-pause reads this |

---

## 5. `segmentation-service` — `segmentation_db`

**Responsibilities (v1.3):** segment definitions and evaluation, eligibility rules and the five-checkpoint Eligibility Chain, optional AI-generated segment insights. Segmentation is the **sole allocation mechanism** (API §3.4) — experiments are random segments, not a separate framework. **Aggregates:** Segment, EligibilityRule.
**Redis:** real-time eligibility-result cache; deterministic random-segment / variant-assignment cache.
**Emits:** `segment.*` (out of this finalization's scope but on the bus); a translated `conversion.recorded` when a `custom.recorded` event matches a running Pulse trigger (Event Model §4.10).

**Table:** `segments`
**Purpose:** Reusable audience definition. Standalone; referenced by variants across campaigns.
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `name`).
**Columns:**
- `id` · `tenant_id` not null · `name` text not null · `type` text `CHECK in ('rule_based','behavioral','temporal','composite','random','ai_generated')` not null · `rules` jsonb not null (attribute/AND-OR/temporal predicate tree) · `hash_seed` text null (deterministic seed for `random` segments — `SHA256(actor_id + seed) mod 100`, Product §5) · `estimated_size` integer null (cached audience estimate for `GET /segments/{id}/estimate`) · `estimated_at` timestamptz · `source` text `CHECK in ('operator','ai_generated')` not null default `operator` · `metadata` jsonb · `created_at` · `updated_at` · `deleted_at` timestamptz null (soft delete; blocked while in use, API §3.4).
**Indexes:** `idx_segments_tenant` (`tenant_id`) `WHERE deleted_at IS NULL`; `idx_segments_type` (`tenant_id`, `type`).

**Table:** `segment_members`
**Purpose:** Materialized membership for non-real-time (behavioral/AI/random-precomputed) segments.
**Primary Key:** (`segment_id`, `participant_id`) — `segment_id` is **local FK**.
**Columns:** `segment_id` · `participant_id` (reference into `referral_db`) · `tenant_id` not null · `added_at` timestamptz not null · `removed_at` timestamptz null · `source` text `CHECK in ('rule_evaluation','ai_suggestion','manual')` not null.
**Indexes:** `idx_segmember_participant` (`tenant_id`, `participant_id`).
**Notes:** Set semantics — re-adding a present member is a no-op (idempotent). `removed_at` keeps history rather than deleting (tombstone), so membership churn is auditable.

**Table:** `eligibility_rules`
**Purpose:** Reusable rule definitions evaluated at the five Eligibility-Chain checkpoints.
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `name`).
**Columns:** `id` · `tenant_id` not null · `name` text not null · `checkpoint` text `CHECK in ('campaign_entry','referral_creation','conversion_validation','reward_approval','payout')` not null · `rule_definition` jsonb not null · `enabled` boolean not null default true · `priority` smallint · `created_at` · `updated_at`.
**Indexes:** `idx_elig_rules_checkpoint` (`tenant_id`, `checkpoint`).

**Table:** `eligibility_evaluations` *(append-only)*
**Purpose:** Audit log of every eligibility decision (feeds `referral.qualified.rules_evaluated`, audit, and AI).
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `participant_id` · `referral_id` null · `campaign_id` · `variant_id` null · `checkpoint` text (same CHECK set) · `result` text `CHECK in ('pass','fail')` not null · `failed_rule_id` text null · `rules_evaluated` jsonb (per-rule trace: name, pass/fail, detail) · `evaluated_at` timestamptz not null.
**Indexes:** `idx_elig_eval_referral` (`tenant_id`, `referral_id`); `idx_elig_eval_participant_time` (`tenant_id`, `participant_id`, `evaluated_at` desc).
**Notes:** Hot results cached in Redis 5 min; this table is the durable, replayable record.

**Table:** `segment_insights` *(optional, AI-fed)*
**Purpose:** AI-detected segment patterns surfaced as read-only `ai_generated` candidates (Product AI map).
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `segment_id` null (set if materialized into a segment) · `ai_decision_log_id` text (reference into `ai_db` for explainability) · `pattern` jsonb · `confidence` numeric(4,3) · `status` text `CHECK in ('suggested','accepted','dismissed')` not null default `suggested` · `created_at` · `updated_at`.
**Notes:** Included because `type='ai_generated'` segments exist; kept minimal — the reasoning chain lives in `ai_db`, not duplicated here.

**Plus:** `event_outbox` (§0.6), `idempotency_keys` (§0.7).

### `segmentation-service` Redis

| Key pattern | Value | TTL | Authoritative | Recompute? | Concurrency |
|---|---|---|---|---|---|
| `elig:{tenant_id}:{participant_id}:{campaign_id}:{checkpoint}` | `pass`/`fail`+`failed_rule_id` | 300 s | `eligibility_evaluations` | Yes | `SET` |
| `variantassign:{campaign_id}:{participant_id}` | `variant_id` | none (sticky) | `referral_db.participant_enrollments` | Yes | `SETNX` (sticky assignment must not flip) |
| `randseg:{segment_id}:{actor_id}` | bucket 0–99 | none (deterministic) | recomputable from `hash_seed` | Yes (pure function) | none — deterministic |

---

## 6. `ingestion-service` — **no RDS (Redis only)**

**Responsibilities (v1.3, API §5):** highest-throughput stateless gateway. Validate → dedup → Business-Rules Guard → enrich → emit to SNS/SQS → return `202`. Owns **no durable relational state**. Latency SLA < 100 ms (p99).
**Why no outbox:** the durable record of an accepted event is the **bus** (SNS/SQS, at-least-once) plus the Redis dedup key; the immutable event store is populated downstream. The dedup key is the idempotency guard that an outbox would otherwise provide.

> All four keyspaces are **Redis-authoritative for in-flight control only**. None hold business truth: if Redis is lost, the worst case is a window of re-accepted duplicates (absorbed by downstream `event_id`/`external_id` idempotency) and reset rate-limit counters — never lost or corrupted business data.

### `ingestion-service` Redis

| Key pattern | Value | TTL | Purpose | If lost | Concurrency |
|---|---|---|---|---|---|
| `dedup:{tenant_id}:{external_id}` | `"1"` | 90 d (API §1, §5.3) | **Primary dedup** — same business event never recorded twice | Possible re-accept; downstream dedup on `event_id`/`external_id` catches it | `SET NX` |
| `touchdedup:{referral_code}:{session_id}:{bucket_5m}` | `"1"` | ~6 min | **Secondary touch dedup** for degraded SDK conditions (Responsibility §4.1) | Brief duplicate touches; attribution tolerant | `SET NX` |
| `ratelimit:{api_key_prefix}:{window}` | integer counter | = window | Per-key rate limits (API §8.1: 5k/10k/etc per min) | Limits reset (fail-open within burst) | `INCR` + `EXPIRE` |
| `ratelimit:code:{referral_code}:{hour}` | integer | 1 h | Business limit: 100 touches/code/hour (API §8.1) | resets | `INCR` |
| `ratelimit:ip:{ip_hash}:{min}` | integer | 1 min | Business limit: 50 touches/min/IP (API §8.1) | resets | `INCR` |
| `campaign:active:{tenant_id}:{campaign_id}` | JSON flag | none (invalidated on `campaign.*`) | Business-Rules Guard campaign-state check (API §5.5) | Re-fetch from `campaign-service` | mirror |
| `code:{referral_code}` | JSON `{campaign_id,variant_id,participant_id,program_id,status,expires_at}` | none (invalidated on `link.*`) | **Code resolution mirror of `referral_db.referral_links`** (R3) — resolves code → campaign/variant at ingestion | Re-fetch from `referral-service` | mirror |
| `session:{tenant_id}:{session_id}` | `anonymous_id` / `referee_id` | = attribution window | Session map seeding stitching (handed to `referral-service`) | Re-derive on next identified event | `SET` |

---

## 7. `referral-service` — `referral_db`

**Responsibilities (v1.3):** touch capture, link/code management, referral Temporal workflows, identity stitching, **attribution computed on the critical path** (conversion → attribution → reward), participant lifecycle & trust. **Aggregates:** Participant, Referee, ReferralLink, Referral, Touch, AttributionRecord.
**Redis:** hot referral-state cache, session→referee map, code mirror source, velocity counters for fraud.
**Emits:** `referral.*`, `link.*`, `participant.state_changed`, `participant.trust_tier_changed` (R6), and the `attribution.computed` signal consumed by `reward-service`.

> **Revised Decision (R3 + R6):** `referral_links` is the authoritative `referral_code` registry (mirrored to Redis for ingestion). `participants` and trust computation live here, not in `tenant_db`, because participants are login-less referral-domain actors and all trust inputs are local.

**Table:** `participants`
**Purpose:** Referrer (external advocate) profile + trust state.
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `email`) where email non-null; (`tenant_id`, `external_id`) where external_id non-null.
**Columns:**
- `id` · `tenant_id` not null · `email` text null · `email_hash` char(64) null (SHA-256; cross-event linking key) · `name` text null · `external_id` text null (client's identifier; idempotency anchor for enrollment, API §3.5) · `lifecycle_state` text `CHECK in ('candidate','active','dormant','reactivated','flagged','suspended','banned')` not null · `trust_tier` text `CHECK in ('unknown','new','trusted','ambassador')` not null default `unknown` **(wire enum, R5)** · `trust_score` smallint not null default 0 `CHECK between 0 and 100` **(source of truth, R5)** · `trust_band` text `CHECK in ('new','established','trusted','advocate')` null (derived from `trust_score` bands 0–25/26–50/51–75/76–100 → drives payout limit & hold, Product §7) · `tags` jsonb · `attributes` jsonb (segment-eval inputs: plan, country, account_age) · `verification_status` text `CHECK in ('none','email','phone','id')` not null default `none` · `created_at` · `updated_at` · `blocked_at` timestamptz null · `metadata` jsonb.
**Indexes:** `idx_participants_tenant_email_hash` (`tenant_id`, `email_hash`); `idx_participants_tenant_external` (`tenant_id`, `external_id`); `idx_participants_trust` (`tenant_id`, `trust_tier`, `updated_at` desc) (frequent fraud/AI queries on tier + recent activity).
**Notes:** Trust score = weighted sum of Account Age 15% / Success Rate 25% / Conversion Quality 20% / Fraud Incidents 25% / Verification 15% (Product §7). `lifecycle_state` and `trust_tier` move on **independent axes** (Product §7) — a `trusted` participant can be `flagged`.

**Table:** `participant_trust_events` *(append-only — added, R7)*
**Purpose:** History of every trust recompute, for audit, the `participant.trust_tier_changed` event, and AI training.
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `participant_id` not null · `previous_score` smallint · `new_score` smallint not null · `previous_tier` text · `new_tier` text · `contributing_factors` jsonb (flat factor weights) · `trigger` text `CHECK in ('scheduled_recompute','conversion','fraud_signal','manual_override','verification')` · `changed_by` text · `occurred_at` timestamptz not null.
**Indexes:** `idx_trustev_participant_time` (`tenant_id`, `participant_id`, `occurred_at` desc).

**Table:** `referees`
**Purpose:** Referee profile; progressive identification (anonymous → email → external id).
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `email`) where non-null; (`tenant_id`, `external_id`) where non-null.
**Columns:** `id` · `tenant_id` not null · `email` text null · `email_hash` char(64) null · `external_id` text null · `anonymous_id` text null · `first_seen_at` timestamptz · `identified_at` timestamptz null · `created_at` · `updated_at` · `metadata` jsonb.
**Indexes:** `idx_referees_email_hash` (`tenant_id`, `email_hash`); `idx_referees_anon` (`tenant_id`, `anonymous_id`).

**Table:** `referral_links` *(authoritative code registry — R3)*
**Purpose:** Generated referral links; the `referral_code → campaign/variant/participant` map mirrored to Redis for ingestion.
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `referral_code`).
**Columns:**
- `id` text PK (= `link_id` in `link.generated`) · `tenant_id` not null · `referral_code` text not null · `participant_id` not null (**local FK**) · `campaign_id` · `variant_id` · `program_id` · `short_url` text · `destination_url` text · `custom_slug` text null · `cookie_ttl_days` smallint · `channel` text `CHECK in ('link','email','widget','api')` · `generation_source` text `CHECK in ('enrollment','api_explicit','sdk_widget','bulk_generation')` not null **(Event Model v3 `link.generated`; `sdk_widget` = lazy generation for an already-enrolled participant on widget render — not self-enrollment)** · `status` text `CHECK in ('active','expired','revoked')` not null default `active` · `total_clicks` integer not null default 0 · `total_referrals_created` integer not null default 0 · `created_at` · `updated_at` · `expires_at` timestamptz null · `revoked_at` timestamptz null · `revocation_reason` text null · `revocation_source` text null.
**Indexes:** `idx_links_code` (`tenant_id`, `referral_code`) unique; `idx_links_participant` (`tenant_id`, `participant_id`); `idx_links_campaign` (`campaign_id`).
**Notes:** Variant resolved at **generation** time, not click time (Product §6). A blocked participant's links resolve to `410` (API §8.2.1) — enforced by `status`/participant `lifecycle_state`. Every insert/state change emits `link.generated`/`link.expired`/`link.revoked` and updates the Redis `code:{referral_code}` mirror.

**Table:** `participant_enrollments`
**Purpose:** Which campaigns a participant is enrolled in + their resolved variant.
**Primary Key:** (`participant_id`, `campaign_id`) — `participant_id` **local FK**.
**Columns:** `participant_id` · `campaign_id` · `variant_id` not null (resolved at enrollment) · `tenant_id` not null · `enrollment_method` text `CHECK in ('api_single','api_bulk','csv_import','crm_connector','auto_rule')` not null · `link_id` text null (**local FK** → `referral_links`) · `enrolled_at` timestamptz not null · `created_by` text.
**Indexes:** `idx_enroll_campaign` (`tenant_id`, `campaign_id`).
**Notes:** Backs the Enrollment-to-Link reconciliation job (Failure §4.3): every `active` participant must have ≥1 link.

**Table:** `referrals`
**Purpose:** Referral workflow instance (one Temporal workflow each). State machine `created→qualified→converted→rewarded` + branches `rejected`/`expired` (Event Model §5.1, Product Spec §2). **Reward reversal is *not* a referral state** — it is modeled at the reward level as `reward.reversed`; a referral whose reward is later reversed stays in `rewarded`.
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `external_id`) where external_id non-null.
**Columns:**
- `id` text PK · `tenant_id` not null · `referral_code` text not null · `participant_id` not null (referrer) · `referee_id` text null (resolved by stitching) · `campaign_id` · `variant_id` · `program_id` · `status` text `CHECK in ('created','qualified','converted','rewarded','rejected','expired')` not null default `created` · `creation_source` text `CHECK in ('touch_event','api_explicit','webhook_relay')` not null · `temporal_workflow_id` text not null · `temporal_run_id` text · `attribution_window_opens_at` timestamptz · `attribution_window_closes_at` timestamptz · `first_touch_at` timestamptz · `last_touch_at` timestamptz · `touch_count` integer not null default 0 · `fraud_score` numeric(4,3) null (0.000–1.000, latest) · `conversion_event_id` text null · `converted_at` timestamptz null · `rejection_reason` text null · `rejection_source` text null · `created_at` · `updated_at` · `external_id` text null · `metadata` jsonb.
**Indexes:** `idx_referrals_code` (`tenant_id`, `referral_code`); `idx_referrals_participant` (`tenant_id`, `participant_id`); `idx_referrals_status` (`tenant_id`, `status`); `idx_referrals_window` (`attribution_window_closes_at`) `WHERE status IN ('created','qualified')` (expiry sweep); `idx_referrals_wf` (`temporal_workflow_id`).
**Notes:** `temporal_workflow_id`/`run_id` (R7) make a stuck workflow inspectable (Failure §5.1) and a crashed worker resumable (Product §6). Idempotency on workflow side-effects keyed by `event_id`.

**Table:** `touches` *(append-only)*
**Purpose:** Every tracked touch (the ten concrete `touch.*` types). Primary attribution input.
**Primary Key:** (`id`) — `id` = platform `event_id` (ULID).
**Unique:** (`tenant_id`, `external_id`) — domain dedup mirror of the ingestion guard.
**Columns:**
- `id` text PK · `tenant_id` not null · `external_id` text not null · `schema_version` smallint not null default 1 · `concrete_type` text `CHECK in ('touch.link_clicked','touch.link_shared','touch.page_viewed','touch.email_invitation_opened','touch.email_link_clicked','touch.widget_viewed')` not null · `referral_id` text null · `referral_code` text not null · `participant_id` text null · `session_id` text null · `anonymous_id` text null · `click_id` text null · `channel` text · `trust_level` text `CHECK in ('high','low')` not null · `api_key_prefix` char(4) null (envelope `source.api_key_prefix` — sender identification, Failure §5.4) · `sdk_version` text null (envelope `source.sdk_version` — build identification, Failure §5.4) · `ip_hash` char(64) null (server-derived) · `user_agent` text null (server-derived) · `device_type` text null · `geo_country` char(2) null · `geo_region` text null · `consent_status` text `CHECK in ('granted','denied','unknown')` not null · `touch_sequence_number` integer null · `utm_source` text null · `utm_medium` text null · `utm_campaign` text null · `utm_content` text null · `utm_term` text null · `properties` jsonb (flat, type-specific: `link_url`, `share_channel`, `page_url`, `invitation_id`, `link_id`, etc.) · `occurred_at` timestamptz not null · `ingested_at` timestamptz not null.
**Indexes:** `idx_touches_referral_seq` (`tenant_id`, `referral_id`, `touch_sequence_number`); `idx_touches_code_time` (`tenant_id`, `referral_code`, `occurred_at`); `idx_touches_session` (`tenant_id`, `session_id`); `idx_touches_utm` (`tenant_id`, `utm_source`, `utm_medium`) (channel analytics).
**Notes:** UTMs are **first-class indexed columns**, not inside `properties` (API §5.2). Append-only; `touch_sequence_number` enables AI sequence models (Event Model §8.4). For `low`-trust touches, `ip_hash`/`user_agent` are server-derived and the body values ignored.

**Table:** `identity_stitching` *(append-only)*
**Purpose:** Session/anonymous → referee linkage records. Stitching updates `referrals.referee_id`; it never edits prior events (Event Model §7.3).
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `session_id` text null · `anonymous_id` text null · `referee_id` text null · `referral_code` text null · `stitch_method` text `CHECK in ('code_based','session_based','email_based')` not null · `confidence` text `CHECK in ('high','medium')` · `stitched_at` timestamptz not null.
**Indexes:** `idx_stitch_session` (`tenant_id`, `session_id`); `idx_stitch_referee` (`tenant_id`, `referee_id`).

**Table:** `attribution_records` *(immutable)*
**Purpose:** The frozen attribution result per referral conversion. Computed as a Temporal activity on the critical path before reward creation.
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `referral_id`, `conversion_event_id`).
**Columns:** `id` · `tenant_id` not null · `referral_id` not null (**local FK**) · `conversion_event_id` text not null · `model_used` text `CHECK in ('first_touch','last_touch','multi_touch_linear','ai_weighted')` not null **(the four canonical models, API §3.1/§3.9)** · `window_days` smallint · `total_attributed_revenue` bigint (minor units) · `currency` char(3) null · `revenue_mrr` bigint null · `revenue_arr` bigint null · `confidence` numeric(4,3) null (AI-weighted only) · `ai_decision_log_id` text null (reference into `ai_db` when `ai_weighted`) · `computed_at` timestamptz not null.
**Indexes:** `idx_attr_referral` (`tenant_id`, `referral_id`).
**Notes:** Immutable — a re-attribution (replay) writes a new row (new `id`); the Failure §4.2 "rewards that would change" report diffs old vs new before any reward mutation.

**Table:** `attribution_touches` *(immutable)*
**Purpose:** Per-touch credit allocation for multi-touch models.
**Primary Key:** (`id`)
**Columns:** `id` · `attribution_record_id` (**local FK**) · `tenant_id` · `touch_id` (**local FK** → `touches`) · `participant_id` · `channel` text · `credit_weight` numeric(5,4) `CHECK between 0 and 1` · `occurred_at` timestamptz.
**Indexes:** `idx_attr_touches_record` (`attribution_record_id`).

**Table:** `experiment_results`
**Purpose:** Variant A/B statistical comparison (sequential testing, α=0.05, power 0.80, early stopping).
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `campaign_id` · `variant_a_id` · `variant_b_id` · `metric` text · `p_value` numeric · `significance_level` numeric · `power` numeric · `sample_size_a` integer · `sample_size_b` integer · `conclusion` text `CHECK in ('significant','not_significant','insufficient_data')` · `computed_at` timestamptz.
**Notes:** Colocated here (R per working doc) because variant resolution + referral data are local; experiments are random segments, not a separate framework (API §3.4).

**Plus:** `event_outbox` (§0.6), `idempotency_keys` (§0.7).

### `referral-service` Redis

| Key pattern | Value | TTL | Authoritative | Recompute? | Concurrency |
|---|---|---|---|---|---|
| `referral:state:{referral_id}` | JSON snapshot | optional | `referrals` | Yes | `SET` on transition |
| `session:{tenant_id}:{session_id}` | `referee_id`/`anonymous_id` | = attribution window | `identity_stitching` / `referees` | Yes | `SET` |
| `code:{referral_code}` (source) | JSON resolution | none (invalidated on `link.*`) | `referral_links` | Yes | mirror → ingestion |
| `velocity:{participant_id}:{window}` | integer | window | derived from `touches`/`referrals` | Yes | `INCR` — fraud velocity signal |

---

## 8. `reward-service` — `reward_db`

**Responsibilities (v1.3):** reward calculation from variant `reward_config`, the reward state machine, approval (auto/manual/AI-assisted), caps & trust ceilings, clawbacks/reversals, the two-step payout batch process, payout-method capture, tax thresholds. **Aggregates:** Reward, CapLedger, Clawback, Payout, PayoutItem, Ledger.
**Redis:** atomic cap counters (the one place strict atomicity is required).
**Emits:** `reward.earned/pending_approval/held/approved/rejected/paid/reversed`, `payout.created/confirmed/completed/failed`.

> **Revised Decision (R4):** reward `status` is one superset enum with an explicit cross-doc mapping, and a first-class `held` state is added.

**Reward status mapping**

| `rewards.status` (stored) | Event Model §5.2 bus event | Product §8 / API §6.1 |
|---|---|---|
| `earned` | `reward.earned` (public webhook: `reward.calculated`) | Pending |
| `pending_approval` | `reward.pending_approval` | Pending (in queue) |
| `held` | `reward.held` | **Held** |
| `approved` | `reward.approved` | Approved |
| `processing` | (processing state; dispatch in flight) | Processing |
| `paid` | `reward.paid` | Paid |
| `rejected` | `reward.rejected` | Rejected |
| `reversed` | `reward.reversed` | Reversed |

**Table:** `rewards`
**Purpose:** Reward instance per referral conversion.
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `referral_id`, `recipient_type`, `triggering_conversion_event_id`) — idempotency: one reward per (referral, recipient, conversion).
**Columns:**
- `id` · `tenant_id` not null · `referral_id` · `participant_id` · `campaign_id` · `variant_id` · `recipient_type` text `CHECK in ('participant','referee')` not null · `recipient_id` text not null · `reward_type` text `CHECK in ('cash','gift_card','account_credit','feature_unlock','extended_trial','discount_code','custom')` not null **(what the reward *is* — Product §8 Reward Types)** · `reward_structure` text `CHECK in ('fixed','percentage','tiered','recurring','milestone','capped')` not null **(how it is *calculated* — Product §8 Reward Structures)** · `amount` bigint not null default 0 (minor units; 0 for non-monetary) · `currency` char(3) null (required when amount>0) · `status` text (CHECK = the 8 mapped values above) not null default `earned` · `approval_mode` text `CHECK in ('auto','manual','auto_below_threshold','ai_assisted')` not null · `approved_by_type` text `CHECK in ('system_auto','ai_assisted','operator')` null · `approved_by_id` text null · `approval_reason` text null · `fraud_score_at_submission` numeric(4,3) null · `fraud_score_at_approval` numeric(4,3) null **(labeled training data, Event Model §8.4)** · `hold_reason` text null · `cooling_period_ends_at` timestamptz null · `hold_until` timestamptz null (trust-tier hold period) · `triggering_conversion_event_id` text not null · `temporal_workflow_id` text · `paid_at` timestamptz null · `created_at` · `updated_at` · `metadata` jsonb.
**Indexes:** `idx_rewards_referral` (`tenant_id`, `referral_id`); `idx_rewards_recipient` (`tenant_id`, `recipient_id`, `status`); `idx_rewards_status` (`tenant_id`, `status`); `idx_rewards_hold` (`hold_until`) `WHERE status='held'` (release sweep).
**Notes:** `held` fires when fraud score is in the 0.3–0.7 band or amount exceeds the trust ceiling (API §3.8, Product §6 step 7). Every transition emits the matching `reward.*` event via outbox.

**Table:** `cap_ledgers`
**Purpose:** Per-referrer / per-campaign / per-program reward caps (count and amount, per period).
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `cap_type`, `scope_id`, `cap_period`, `period_start`).
**Columns:** `id` · `tenant_id` not null · `cap_type` text `CHECK in ('per_referrer','per_campaign','per_program')` not null · `scope_id` text not null (participant/campaign/program ULID) · `participant_id` text null · `campaign_id` text null · `program_id` text null · `cap_period` text `CHECK in ('day','week','month','campaign_lifetime')` not null · `period_start` date not null · `current_count` integer not null default 0 · `max_count` integer null · `current_amount` bigint not null default 0 · `max_amount` bigint null · `currency` char(3) null · `updated_at`.
**Indexes:** unique constraint above doubles as the lookup index.
**Notes:** Enforced atomically. The **authoritative** counter is this row, guarded by a PostgreSQL **advisory lock** (`pg_advisory_xact_lock(hashtext(key))`) during increment; Redis (`cap:*`) is a hot read cache only and is recomputable from this table.

**Table:** `reward_ledger_entries` *(append-only — added, R7)*
**Purpose:** Immutable money ledger per participant — earned / paid / reversed. Backs the monthly payout-limit carry-over (Product §7: "withdraws €500 now; rest carries over") and the saga's **negative ledger entry** on late reversal (Product §6).
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `participant_id` not null · `reward_id` text null · `payout_item_id` text null · `entry_type` text `CHECK in ('reward_earned','payout_paid','clawback_negative','adjustment')` not null · `amount` bigint not null (signed; negative for clawback) · `currency` char(3) not null · `balance_after` bigint null (optional running balance) · `reason` text null · `occurred_at` timestamptz not null.
**Indexes:** `idx_ledger_participant_time` (`tenant_id`, `participant_id`, `occurred_at` desc).

**Table:** `clawbacks` *(append-only)*
**Purpose:** Reversal audit records (reason mandatory, API §3.8). "Clawback" is the internal term for the recovery action; the corresponding reward transition is `status='reversed'` and the bus event is `reward.reversed` (Event Model §5.2) — there is no `reward.clawed_back` event.
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `reward_id` (**local FK**) · `referral_id` · `clawback_reason` text **not null** · `clawback_amount` bigint not null · `currency` char(3) not null · `initiated_by_type` text `CHECK in ('system_auto','operator')` not null · `initiated_by_id` text null · `trigger` text `CHECK in ('refund','chargeback','fraud_post_payout','manual')` · `ledger_entry_id` text null (**local FK** → `reward_ledger_entries`, the negative entry) · `created_at`.
**Indexes:** `idx_clawbacks_reward` (`tenant_id`, `reward_id`).

**Table:** `participant_payout_methods`
**Purpose:** Payout destination set via the magic-link portal (token-scoped write, API §3.15/§8.2). **No raw bank data** (Product §8 — providers hold it).
**Primary Key:** (`id`)
**Unique:** partial unique `(tenant_id, participant_id) WHERE is_default`.
**Columns:** `id` · `tenant_id` not null · `participant_id` not null · `method_type` text `CHECK in ('paypal','wise','sepa','gift_card','credit')` not null · `provider_reference_id` text null (token/ref at provider — never a bank number) · `paypal_email_hash` char(64) null · `is_default` boolean not null default true · `status` text `CHECK in ('pending','verified','disabled')` not null · `created_at` · `updated_at`.
**Notes:** Stores only method type, provider reference, and (for PayPal) email hash.

**Table:** `participant_tax_records` *(added — Product §8)*
**Purpose:** Tax-threshold tracking (USA $600 W-9/1099; EU none).
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `participant_id`, `tax_year`).
**Columns:** `id` · `tenant_id` not null · `participant_id` not null · `tax_year` smallint not null · `jurisdiction` char(2) · `ytd_reward_amount` bigint not null default 0 · `currency` char(3) · `w9_status` text `CHECK in ('not_required','requested','received')` not null default `not_required` · `form_1099_filed` boolean not null default false · `backup_withholding` boolean not null default false · `updated_at`.

**Table:** `payouts`
**Purpose:** Payout batch (two-step: create → confirm → processing → completed/partially_failed/failed).
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `status` text `CHECK in ('pending','processing','completed','partially_failed','failed')` not null default `pending` · `fulfillment_method` text `CHECK in ('paypal','wise','sepa','gift_card','credit')` not null · `total_amount` bigint not null · `currency` char(3) not null · `item_count` integer not null · `description` text · `confirmed_by` text null · `confirmed_at` timestamptz null · `completed_at` timestamptz null · `total_disbursed` bigint null · `temporal_workflow_id` text · `created_at` · `metadata` jsonb.
**Indexes:** `idx_payouts_status` (`tenant_id`, `status`).
**Notes:** Confirm is a separate Keto `payouts:confirm` action (API §3.10). Items for blocked participants are excluded from new batches (API §8.2.1).

**Table:** `payout_items`
**Purpose:** Line items linking rewards to a batch.
**Primary Key:** (`id`)
**Unique:** (`payout_id`, `reward_id`).
**Columns:** `id` · `payout_id` (**local FK**) · `tenant_id` · `participant_id` · `reward_id` (**local FK** logical to `rewards`) · `amount` bigint · `currency` char(3) · `status` text `CHECK in ('pending','completed','failed')` not null · `external_transfer_id` text null · `failure_reason` text null · `created_at` · `updated_at`.
**Indexes:** `idx_payout_items_payout` (`payout_id`); `idx_payout_items_reward` (`tenant_id`, `reward_id`).

**Plus:** `event_outbox` (§0.6), `idempotency_keys` (§0.7).

### `reward-service` Redis

| Key pattern | Value | TTL | Authoritative | Recompute? | Concurrency |
|---|---|---|---|---|---|
| `cap:{cap_type}:{scope_id}:{period}:{period_start}` | JSON `{count,amount}` | end of period | `cap_ledgers` | Yes | **read cache only**; authoritative increment uses PG advisory lock + `cap_ledgers` |
| `payoutlimit:{participant_id}:{month}` | integer (disbursed minor units) | end of month | `reward_ledger_entries` | Yes | `INCRBY` on payout; gated by `trust_band` limit |

---

## 9. `analytics-service` — `analytics_db` (PostgreSQL only)

**Responsibilities (v1.3):** dashboard KPIs, funnel/revenue/leaderboard reads, **Program Health Score** computation, periodic snapshots. Eventual consistency (5–30 s) is acceptable. **Attribution is *not* here** — it is on the critical path in `referral-service` (§7).
**Redis:** real-time KPI counters bridging the gap before snapshots refresh.

> **Revised Decision (R2):** all ClickHouse tables/views are **out of scope** for this document. Heavy OLAP (the wide `events` table and materialized views) is deferred to a separate ClickHouse specification. `analytics_db` holds only the small PostgreSQL projection tables below.

**Table:** `kpi_snapshots` *(append-only)*
**Purpose:** Periodic KPI computations for dashboards (pure reporting projection).
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `scope_type`, `scope_id`, `kpi_type`, `period_start`, `period_end`).
**Columns:** `id` · `tenant_id` not null · `scope_type` text `CHECK in ('program','campaign','variant','participant','tenant')` · `scope_id` text · `program_id` text null · `campaign_id` text null · `variant_id` text null · `kpi_type` text (e.g. `conversion_rate`, `revenue_attributed`, `clicks`, `rewards_paid`) · `value` numeric · `currency` char(3) null · `period_start` timestamptz · `period_end` timestamptz · `computed_at` timestamptz not null.
**Indexes:** `idx_kpi_scope_time` (`tenant_id`, `scope_type`, `scope_id`, `period_end` desc).

**Table:** `health_scores` *(append-only)*
**Purpose:** Program Health Score (Product §11) — nightly 0–100 composite + four weighted sub-scores. Projected to `campaign_db.programs.health_score` for the `GET /programs/{id}/health` read.
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `program_id`, `computed_for_date`).
**Columns:** `id` · `tenant_id` not null · `program_id` not null · `composite_score` smallint `CHECK between 0 and 100` · `funnel_score` smallint (weight 30%) · `revenue_score` smallint (35%) · `fraud_pressure_score` smallint (20%) · `saturation_score` smallint (15%) · `deltas` jsonb (week-over-week sub-score changes feeding the Insights Panel) · `computed_for_date` date not null · `computed_at` timestamptz not null.
**Indexes:** `idx_health_program_date` (`tenant_id`, `program_id`, `computed_for_date` desc).
**Notes:** Decomposition and weights match Product §11 exactly. Anomalies/deltas here are read by `ai-service` to generate Insights recommendations.

**Table:** `reconciliation_runs` *(added — Failure §4.3)*
**Purpose:** Outcomes of the periodic cross-source reconciliation jobs (orphan conversions, orphan payouts, count drift, etc.).
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` text null (some jobs are platform-wide) · `job_name` text `CHECK in ('conversion_to_attribution','reward_to_referral','billing_to_platform_revenue','payout_to_reward','participant_vs_trust','webhook_delivery','revenue_sanity','enrollment_to_link')` not null **(the eight jobs of Failure §4.3)** · `window_start` timestamptz · `window_end` timestamptz · `checked_count` integer · `mismatch_count` integer · `mismatches` jsonb (sample of flagged ids + cause) · `action_taken` text (e.g. `replay_triggered`, `flagged_only`) · `status` text `CHECK in ('ok','mismatch','error')` · `ran_at` timestamptz not null.
**Indexes:** `idx_recon_job_time` (`job_name`, `ran_at` desc).
**Notes:** This is the persisted, queryable evidence the on-call debugging checklists (Failure §5) reference ("recent reconciliation-job outputs").

**Plus:** `idempotency_keys` only if it exposes mutating endpoints (it is read-mostly; typically none). No `event_outbox` (no domain events emitted).

### `analytics-service` Redis

| Key pattern | Value | TTL | Authoritative | Recompute? | Concurrency |
|---|---|---|---|---|---|
| `kpi:live:{tenant_id}:{campaign_id}:{kpi}` | integer/float counter | rolling | `kpi_snapshots` (and the OLAP store, out of scope) | Yes | `INCR`/`INCRBYFLOAT` on domain events |
| `leaderboard:{tenant_id}:{campaign_id}` | Redis Sorted Set (participant → revenue) | rolling | recomputable from referral/reward data | Yes | `ZINCRBY` |

---

## 10. `notification-service` — `notification_db`

**Responsibilities (v1.3):** outbound webhooks (config, delivery, retry, signing, auto-disable), transactional emails (SES), in-app notifications, **inbound provider receivers** (Method B callbacks → `conversion.recorded`), endpoint health. **Aggregates:** WebhookEndpoint, WebhookDelivery, NotificationTemplate, NotificationDelivery, InboundReceipt.
**Redis:** delivery in-flight locks, endpoint-health counters.
**Emits:** optional delivery domain events; relays inbound callbacks as tracked `conversion.recorded` into ingestion.

**Table:** `webhook_endpoints`
**Purpose:** Client webhook subscription config.
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `url` text not null · `secret` text not null (HMAC-SHA256 signing key, encrypted at rest) · `api_version` text not null (pinned per subscription, API §6.4 — locks payload schema) · `event_filters` jsonb not null (array; wildcards `referral.*`, `reward.*`, `*`) · `status` text `CHECK in ('active','disabled')` not null default `active` · `consecutive_failures` smallint not null default 0 · `created_at` · `updated_at` · `disabled_at` timestamptz null.
**Indexes:** `idx_webhook_ep_tenant` (`tenant_id`) `WHERE status='active'`.
**Notes:** Auto-disabled after **50 consecutive failures** + owner notification (API §6.3).

**Table:** `webhook_deliveries` *(append-only per attempt-state)*
**Purpose:** Per-event delivery log with retry schedule.
**Primary Key:** (`id`)
**Unique:** (`webhook_endpoint_id`, `event_id`) — dedup on the delivery `id`/`event_id` (API §6.2/§6.3).
**Columns:** `id` · `webhook_endpoint_id` (**local FK**) · `tenant_id` not null · `event_id` text not null (the envelope delivery id) · `event_type` text not null · `payload` jsonb (the pinned-version envelope) · `signature` text · `status` text `CHECK in ('pending','delivered','failed','exhausted')` not null default `pending` · `http_status_code` smallint null · `attempt_count` smallint not null default 0 · `next_retry_at` timestamptz null · `last_attempted_at` timestamptz null · `delivered_at` timestamptz null · `error_message` text null · `created_at`.
**Indexes:** `idx_wh_deliv_retry` (`next_retry_at`) `WHERE status='pending'`; `idx_wh_deliv_endpoint` (`webhook_endpoint_id`, `created_at` desc).
**Notes:** Retry schedule 1m→5m→30m→2h→12h→24h (7 attempts, API §6.3). Backs the Webhook-Delivery reconciliation job (Failure §4.3). Exhausted deliveries route to `dlq-webhooks` (infra, not a DB table). The stored `event_type` uses the **public webhook vocabulary** (API §6.1) — `reward.calculated/held/approved/paid/reversed`, `payout.sent/failed`, `campaign.activated/paused/completed/budget_threshold`. This is *almost* identical to the internal domain events (Event Model §5): the reward terminal names already match (`reward.paid`, `reward.reversed`), and the only translations are `reward.earned`→`reward.calculated` and the internal campaign state `ended`→public `campaign.completed`. Public events are pinned per subscription `api_version`.

**Table:** `notification_templates`
**Purpose:** Email/in-app templates (platform-level when `tenant_id` null).
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` text null · `template_type` text `CHECK in ('enrollment','reward_earned','reward_approved','reward_paid','payout_sent','campaign_activated','fraud_alert','nudge_reengagement','endpoint_disabled')` not null · `channel` text `CHECK in ('email','in_app')` not null · `subject_template` text · `body_template` text · `locale` text · `is_active` boolean not null default true · `created_at` · `updated_at`.

**Table:** `notification_deliveries` *(append-only)*
**Purpose:** Outbound email/in-app delivery log (SES).
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `template_id` text null (**local FK**) · `template_type` text · `recipient_email_hash` char(64) null · `recipient_id` text null (participant/operator) · `channel` text · `status` text `CHECK in ('queued','sent','delivered','bounced','failed','suppressed')` not null · `provider_message_id` text null · `consent_checked` boolean (participant consent gate, Responsibility §3) · `sent_at` timestamptz null · `created_at` · `metadata` jsonb.
**Indexes:** `idx_notif_deliv_recipient` (`tenant_id`, `recipient_id`, `created_at` desc).
**Notes:** Stores `recipient_email_hash`, not raw email, consistent with no-raw-PII rules.

**Table:** `endpoint_health`
**Purpose:** Webhook endpoint health state driving auto-disable + health dashboard.
**Primary Key:** (`webhook_endpoint_id`) — **local FK**, 1:1 with `webhook_endpoints`.
**Columns:** `webhook_endpoint_id` · `tenant_id` not null · `consecutive_failures` smallint not null default 0 · `total_deliveries` bigint not null default 0 · `total_failures` bigint not null default 0 · `last_success_at` timestamptz null · `last_failure_at` timestamptz null · `auto_disabled_at` timestamptz null · `owner_notified_at` timestamptz null · `updated_at`.

**Table:** `inbound_webhook_receipts` *(append-only — added, API §6.5 / Failure §4)*
**Purpose:** Idempotent audit of third-party provider callbacks (Stripe/Paddle/Chargebee/PayPal/Wise/gift-card/CRM) before translation to `conversion.recorded` / payout state. "Data, never commands" (API §6.5).
**Primary Key:** (`id`)
**Unique:** (`tenant_id`, `integration_id`, `provider_event_id`) — idempotent by the provider's native event id (mapped to `external_id`).
**Columns:** `id` · `tenant_id` text null (null until tenant resolved → `404` if unknown) · `provider` text `CHECK in ('stripe','paddle','chargebee','paypal','wise','gift_card','crm')` not null · `integration_id` text null · `provider_event_id` text not null · `provider_event_type` text · `signature_verified` boolean not null · `raw_payload` jsonb (retained for Method B debugging, Failure §5.2) · `translated_to` text `CHECK in ('conversion.recorded','payout.sent','payout.failed','reward.paid','reward.reversed','participant.enrolled','dropped_signature_fail','dropped_unknown_tenant')` · `refrev_ref_code` text null (Method B correlation from provider metadata) · `received_at` timestamptz not null.
**Indexes:** `idx_inbound_provider` (`provider`, `received_at` desc); `idx_inbound_refcode` (`tenant_id`, `refrev_ref_code`).
**Notes:** Signature failure → `401`, payload **dropped not queued** (recorded here as `dropped_signature_fail`). Backs the Billing-to-Platform Revenue reconciliation (Failure §4.3) and "unattributed payments" debugging.

**Plus:** `event_outbox` (§0.6), `idempotency_keys` (§0.7).

### `notification-service` Redis

| Key pattern | Value | TTL | Authoritative | Recompute? | Concurrency |
|---|---|---|---|---|---|
| `whdeliver:lock:{delivery_id}` | `"1"` | ~30 s | `webhook_deliveries` | Yes | `SET NX` — single-flight a delivery attempt across workers |
| `ephealth:{webhook_endpoint_id}` | integer consecutive_failures | none | `endpoint_health` | Yes | `INCR`/reset; triggers auto-disable at 50 |
| `inbounddedup:{integration_id}:{provider_event_id}` | `"1"` | 90 d | `inbound_webhook_receipts` | Yes | `SET NX` |

---

## 11. `ai-service` — `ai_db`

**Responsibilities (v1.3):** fraud scoring (rule + ML), recommendations (campaign setup, optimization, segmentation, incentive), insights, AI-weighted attribution support, decision logging & explainability, model registry. **AI is advisory except two narrow autonomous decisions** — Incentive Optimization (sub-threshold reward tweaks) and Fraud auto-block (Product §11). **Aggregates:** AiDecisionLog, Recommendation, FraudRule, FraudReview, ModelArtifact, PromptVersion.
**Redis:** inference cache (fraud scores), event dedup.
**Emits:** `fraud.signal_raised`, `recommendation.created`; consumes referral/conversion/reward events.

**Table:** `ai_decision_logs` *(append-only)*
**Purpose:** Single source of truth for "what did AI do, when, why, at what cost." Explainability + reproducibility. Retained 24 months.
**Primary Key:** (`id`)
**Columns:**
- `id` · `tenant_id` not null · `decision_type` text `CHECK in ('fraud_score','recommendation','insight','segment_suggestion','health_insight','attribution_weighting','incentive_optimization')` not null · `is_autonomous` boolean not null default false (true only for incentive-optimization tweaks + fraud auto-block) · `compute_tier` text `CHECK in ('rule_based','ml_based','llm')` not null (maps to Event Model `detection_layer`; `rule_based` = zero LLM cost) · `model_used` text null (e.g. model id/version; null for pure rules) · `prompt_version_id` text null (**local FK** → `prompt_versions`) · `model_artifact_id` text null (**local FK** → `model_artifacts`) · `subject_type` text `CHECK in ('referral','participant','campaign','variant','program','conversion')` · `subject_id` text · `input_context` jsonb (≤8000 tokens; consent-respecting features only) · `output` jsonb · `reasoning_chain` text null · `bounds_satisfied` jsonb null (for autonomous decisions: the guardrail bounds it stayed within, e.g. `max_increase=25%`) · `triggering_recommendation_id` text null (**local FK** — links a Decision to its Recommendation, Product §11 discipline) · `confidence` numeric(4,3) null · `latency_ms` integer · `token_count` integer null · `cost_estimate` numeric(10,5) null · `created_at` timestamptz not null.
**Indexes:** `idx_ai_decisions_subject` (`tenant_id`, `subject_type`, `subject_id`, `created_at` desc); `idx_ai_decisions_type` (`tenant_id`, `decision_type`, `created_at` desc).
**Notes:** Every autonomous Decision logs its triggering Recommendation + the bounds it satisfied and is reversible by Human Override (Product §11) — enforced structurally by the non-null links above. `fraud_score` rows here feed `referrals.fraud_score` and the Participant-vs-Trust reconciliation (Failure §4.3).

**Table:** `prompt_versions`
**Purpose:** Versioned LLM prompt templates (A/B testing, audit). Retained indefinitely.
**Primary Key:** (`id`)
**Unique:** (`prompt_name`, `version`).
**Columns:** `id` · `tenant_id` text null (platform prompts) · `prompt_name` text not null · `version` integer not null · `template` text not null · `model_target` text · `is_active` boolean not null default false · `created_by` text · `created_at`.
**Indexes:** `idx_prompt_active` (`prompt_name`) `WHERE is_active`.

**Table:** `recommendations`
**Purpose:** AI suggestions (advisory) operators accept/dismiss (API §3.12).
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `recommendation_type` text `CHECK in ('campaign_setup','optimization','segmentation','incentive','playbook_fit')` not null · `subject_type` text · `subject_id` text null · `payload` jsonb not null (the proposed change + natural-language explanation) · `ai_decision_log_id` text (**local FK** — explainability) · `status` text `CHECK in ('pending','accepted','dismissed','expired')` not null default `pending` · `accepted_by` text null · `accepted_at` timestamptz null · `dismissed_reason` text null · `applied_resource_id` text null (the campaign/variant created/updated on accept) · `created_at` · `expires_at` timestamptz null.
**Indexes:** `idx_recos_status` (`tenant_id`, `status`, `created_at` desc).
**Notes:** Accept applies via `campaigns:write` or `rewards:approve` (API §3.12) and is recorded; dismiss feeds AI feedback.

**Table:** `fraud_rules`
**Purpose:** Deterministic (rule-based) fraud rule configs — zero LLM cost.
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` text null (platform-level rules) · `rule_name` text not null · `signal_type` text `CHECK in ('self_referral','velocity_abuse','disposable_email','vpn_proxy','device_fingerprint_match','payment_reversal','geographic_mismatch','bot_pattern','collusion_pattern','reward_harvesting')` not null · `condition` jsonb not null · `checkpoint` text `CHECK in ('referral_creation','qualification','reward_approval','payout')` · `auto_action` text `CHECK in ('reward_held','participant_flagged','auto_blocked','none')` not null default `none` · `threshold` numeric(4,3) null · `enabled` boolean not null default true · `created_at` · `updated_at`.
**Notes:** Per-checkpoint auto-block thresholds (Product §7): creation >0.8, qualification >0.7, reward approval >0.7, payout >0.6.

**Table:** `fraud_reviews`
**Purpose:** Human-in-the-loop fraud review queue. **Only humans can ban.**
**Primary Key:** (`id`)
**Columns:** `id` · `tenant_id` not null · `participant_id` text null · `referral_id` text null · `signal_type` text (same CHECK set as `fraud_rules.signal_type`) · `severity` text `CHECK in ('low','medium','high','critical')` not null · `detection_layer` text `CHECK in ('rule_based','ml_based','aggregate_analysis')` · `evidence` jsonb (flat key/value pairs, Event Model §5.3) · `fraud_report` jsonb (reasoning chain) · `ai_decision_log_id` text (**local FK**) · `review_status` text `CHECK in ('pending','approved','rejected','banned')` not null default `pending` · `reviewed_by` text null · `reviewed_at` timestamptz null · `reason` text null · `temporal_workflow_id` text null · `created_at`.
**Indexes:** `idx_fraud_reviews_status` (`tenant_id`, `review_status`, `severity`); `idx_fraud_reviews_participant` (`tenant_id`, `participant_id`).
**Notes:** Benign coverage-loss signals (dropped beacon, CMP timeout, lost webhook) **never** feed the fraud score (Failure §4.4) — they are not written here as signals.

**Table:** `model_artifacts`
**Purpose:** ML model metadata registry. Weights in S3, metadata here, **no PII in training**.
**Primary Key:** (`id`)
**Unique:** (`model_type`, `version`).
**Columns:** `id` · `model_type` text `CHECK in ('fraud_ml','propensity','attribution_ai','churn')` not null · `version` text not null · `s3_path` text not null · `training_dataset_description` text · `performance_metrics` jsonb · `is_active` boolean not null default false · `created_at`.
**Indexes:** `idx_model_active` (`model_type`) `WHERE is_active`.

**Plus:** `event_outbox` (§0.6), `idempotency_keys` (§0.7).

### `ai-service` Redis

| Key pattern | Value | TTL | Authoritative | Recompute? | Concurrency |
|---|---|---|---|---|---|
| `fraudscore:{participant_id}` | float 0–1 + signals | 300 s | `ai_decision_logs` | Yes (re-score) | `SET` |
| `aidedup:{event_id}` | `"1"` | 24 h | n/a (idempotency only) | n/a | `SET NX` — don't double-score an event |
| `infer:cache:{decision_type}:{input_hash}` | JSON output | varies | `ai_decision_logs` | Yes | `SET`; cost control on repeat LLM calls |

---

## 12. Cross-Service Data Considerations

### 12.1 Foreign references without cross-DB FKs
Within a service, integrity is enforced by **real `FOREIGN KEY`s on the ULID `id`** (the **local FK**s marked above: e.g. `variants.campaign_id → campaigns.id`, `payout_items.payout_id → payouts.id`). Across services there are **no** database FKs: every inter-service reference (`campaign_id`, `variant_id`, `participant_id`, `referral_id`, `reward_id`, `program_id`, `segment_id`) is the **same ULID `id` by value** (`char(26)`), validated in service logic, because a sibling service's rows are not local. This preserves the v1.3 hard constraint (no shared tables, no cross-service FKs); the local and cross-service reference is the very same ULID, so there is no key translation at the boundary.

### 12.2 Idempotency & replay
Two **separate** regimes (Responsibility §4.1), never sharing an id:
- **Ingestion / domain dedup:** `tenant_id` + `external_id`, 90-day window. Redis-authoritative at ingestion (`dedup:*`); mirrored as `UNIQUE (tenant_id, external_id)` on the durable landing tables (`touches`, `event_outbox`). Domain events derive `external_id` deterministically from a domain fact (e.g. `reward.approved:{reward_id}`) so retries/replays reproduce it.
- **Request idempotency:** `Idempotency-Key` header, per tenant + key, 24 h, in each service's `idempotency_keys` table; returns the original stored response, `409` on key reuse with a different body.
- **Replay safety:** the immutable append-only stores (`touches`, ledgers, `*_decision_logs`, `event_outbox`) plus consumer-side `event_id` idempotency guarantee a replay (Failure §4.2) cannot double-count. Attribution replay first emits a "rewards that would change" diff for approval before mutating `rewards`.

### 12.3 Audit trails
`created_by` / `reason` are mandatory on every money- or trust-affecting row: `clawbacks` (reason not-null), `rewards` (`approved_by_*`, `approval_reason`), `fraud_reviews` (`reviewed_by`, `reason`), `payouts` (`confirmed_by`), participant block/trust changes (`participant_trust_events.changed_by`), and the platform-wide `tenant_db.audit_log` (operator actions, tenant lifetime + 12 months, API §8.3). Append-only ledgers (`reward_ledger_entries`) make money movement reconstructable.

### 12.4 AI & fraud support (what is persisted for it)
- `participants.trust_tier` + `trust_score` + `participant_trust_events` history (trust model inputs & labels).
- `referrals.fraud_score`; `rewards.fraud_score_at_submission` / `fraud_score_at_approval` (labeled training data, Event Model §8.4); later `clawbacks` close the label loop.
- `touches` with `touch_sequence_number` + indexed UTMs (sequence & channel features for AI-weighted attribution).
- `attribution_records.confidence` + `ai_decision_log_id` for AI-weighted attribution explainability.
- `ai_db`: full decision logs (model, prompt version, tokens, cost, reasoning, bounds, triggering recommendation), fraud rules & reviews, model registry.
- `analytics_db.health_scores` + `reconciliation_runs` (anomaly inputs + correctness evidence).

### 12.5 Tie-back to the three governing models
- **Event Model v3.0** — column names mirror envelope/`properties` fields (`external_id`, `event_id`→`id`, `schema_version`, `consent_status`, flat `revenue_*` on conversions, `touch_sequence_number`, attribution-context fields on `referrals`/`touches`). Enums (`signal_type`, `reward_type`, `model_used`, `checkpoint`, lifecycle states) match the event enums exactly; trust-tier reconciliation per R5.
- **Responsibility Contract v3.0** — SDK never persists decisions; all monetary/identity truth lands under secret-key paths into `referral_db`/`reward_db`; server-derived `ip_hash`/`user_agent` stored, never client-claimed; deterministic `external_id` ownership reflected by the dedup uniqueness constraints.
- **Failure & Observability Model v3.0** — persisted for recovery/debugging: `temporal_workflow_id`/`run_id` (stuck-workflow inspection & resume), `event_outbox` (at-least-once emission), `inbound_webhook_receipts` (Method B reconciliation & "unattributed payments"), `reconciliation_runs` (job evidence), correlation keys (`external_id`→`id`→`referral_id`→ attribution context `campaign_id`→`variant_id`→`participant_id` →`reward_id`→`payout_id`, plus `session_id`/`anonymous_id`/`actor_email_hash`/`click_id`/`integration_id`/`api_key_prefix`/`sdk_version`) all present as indexed columns across the chain. DLQs remain SQS infrastructure (not DB tables); DLQ *entries* retain the full envelope, which the `event_outbox` payload reproduces on scoped replay.

---

## 13. Summary Matrix

| # | Service | Database | Core tables | + plumbing | Redis | ClickHouse |
|---|---------|----------|-------------|------------|-------|------------|
| 1 | tenant-service | `tenant_db` (+ Ory colocated) | tenants, users, roles, user_roles, api_keys, oauth2_clients, sessions, tenant_verifications, audit_log (9) | outbox, idempotency | sessions, Keto cache, key cache | — (out of scope) |
| 2 | campaign-service | `campaign_db` | programs, campaigns, variants, pulses, playbooks (5) | outbox, idempotency | active-campaign, budget spend | — |
| 3 | segmentation-service | `segmentation_db` | segments, segment_members, eligibility_rules, eligibility_evaluations, segment_insights (5) | outbox, idempotency | eligibility, variant assignment, random bucket | — |
| 4 | ingestion-service | **none** | 0 | — | dedup, touch dedup, 3× rate-limit, campaign cache, code mirror, session map | — |
| 5 | referral-service | `referral_db` | participants, participant_trust_events, referees, referral_links, participant_enrollments, referrals, touches, identity_stitching, attribution_records, attribution_touches, experiment_results (11) | outbox, idempotency | referral state, session map, code source, velocity | — |
| 6 | reward-service | `reward_db` | rewards, cap_ledgers, reward_ledger_entries, clawbacks, participant_payout_methods, participant_tax_records, payouts, payout_items (8) | outbox, idempotency | cap counters, payout limit | — |
| 7 | analytics-service | `analytics_db` | kpi_snapshots, health_scores, reconciliation_runs (3) | (read-mostly) | live KPI counters, leaderboard | **deferred (separate doc)** |
| 8 | notification-service | `notification_db` | webhook_endpoints, webhook_deliveries, notification_templates, notification_deliveries, endpoint_health, inbound_webhook_receipts (6) | outbox, idempotency | delivery lock, endpoint health, inbound dedup | — |
| 9 | ai-service | `ai_db` | ai_decision_logs, prompt_versions, recommendations, fraud_rules, fraud_reviews, model_artifacts (6) | outbox, idempotency | fraud cache, event dedup, inference cache | — |

**Totals:** 8 PostgreSQL databases (ingestion has none), **53 core tables** + per-service `event_outbox`/`idempotency_keys` plumbing, Redis across 8 services, Ory tables colocated in `tenant_db` (uncounted). ClickHouse is excluded by design (R2) and specified separately.

**Load-bearing design decisions, restated:**
1. **ULID single-key model** — every table has **one** identifier, the app-generated ULID `id` (`char(26)`), serving as the physical `PRIMARY KEY`, the business id, and the wire id (API, events, all cross-service references). No `bigint` surrogate: intra-service FKs and cross-service refs are the same ULID, so there is no key translation at any boundary. The bounded ULID-PK latency cost is accepted for one-id simplicity (R8).
2. **Attribution lives in `referral_db`**, on the critical path (conversion → attribution → reward), so heavy reporting never starves it.
3. **One authoritative code registry** (`referral_db.referral_links`), mirrored to Redis for sub-100ms ingestion resolution (R3).
4. **Redis holds only in-flight control and recomputable caches**; every Redis value can be rebuilt from PostgreSQL, except atomic cap/limit increments which are guarded by PG advisory locks with `cap_ledgers`/`reward_ledger_entries` as the durable truth.
5. **Outbox + idempotency + immutable ledgers/logs** make the Failure Model's at-least-once, replayable, reconcilable guarantees real without cross-service transactions.

> **Note:** Column types and names are implementation-ready but remain subject to migration-time refinement. Enum value sets track the Event Model; adding a value is a non-breaking change (text+CHECK swap). Ory-managed schemas follow Ory's own definitions.
