# ReferralAI — Public API Contract

## Version 1.2 — Implementation-Ready Specification

> **Classification:** Internal — Architecture  
> **Last Updated:** February 2026  
> **Author:** API Architecture Team  
> **Companion Documents:**  
> - Product & Domain Specification v2.0 (`referralai_product_spec_v2.md`)  
> - Referral Revenue OS Product Specification v3.2 (`referral_platform_product_spec.md`)  
> **Audience:** Backend engineers, integration partners, SDK maintainers

---

## Table of Contents

1. [API Design Principles](#1-api-design-principles)
2. [Authentication & Authorization](#2-authentication--authorization)
3. [Core Resources & Endpoints](#3-core-resources--endpoints)
4. [SDK & Widget Endpoints (Publishable Key)](#4-sdk--widget-endpoints)
5. [Event Ingestion API (Deep Dive)](#5-event-ingestion-api)
6. [Webhooks (Outbound API)](#6-webhooks-outbound-api)
7. [Security & Abuse Considerations](#7-security--abuse-considerations)

---

# 1. API Design Principles

## 1.1 Foundational Constraints

This API is the single integration surface for the platform. There are no private or internal-only endpoints. The dashboard UI, the JS SDK, and customer backends all consume the same contract. Privilege separation is handled entirely through authentication mechanisms and scopes — not through separate API surfaces.

The API is REST-based. No GraphQL. This is deliberate: the platform serves clients with varying levels of technical sophistication (from engineering-heavy SaaS companies to solo creators using no-code tools). REST provides the widest compatibility surface, the simplest debugging model, and the most predictable caching behavior.

## 1.2 Resource Naming Conventions

All resource paths use **lowercase plural nouns**, following the ownership chain defined in the domain model. Resources are nested only when the relationship is strict composition (a child cannot exist without its parent). Where the relationship is association or reference, the child resource is top-level with a filter parameter.

```
Strict composition (nested):
  /v1/programs/{program_id}/campaigns
  /v1/campaigns/{campaign_id}/variants

Association (top-level with filters):
  /v1/referrals?campaign_id=xxx
  /v1/rewards?referrer_id=xxx
  /v1/events?referral_id=xxx

SDK/Widget (publishable key surface):
  /v1/sdk/widget-config
  /v1/sdk/enroll
  /v1/sdk/resolve-link
```

The nesting depth never exceeds three segments after the version prefix. If a deeper path would be required, the resource is promoted to top-level.

Resource identifiers are **opaque ULIDs** (Universally Unique Lexicographically Sortable Identifiers). ULIDs are time-ordered, lexicographically sortable (critical for cursor-based pagination and ClickHouse performance), and encode as 26-character Crockford Base32 strings. The API never exposes sequential IDs, internal row IDs, or any identifier from which ordering or volume can be inferred.

**Naming rules:**

- Plural nouns for collections: `/v1/programs`, `/v1/referrals`
- Singular noun implicit in item access: `/v1/programs/{id}`
- Actions that do not map to CRUD use a verb sub-resource: `/v1/campaigns/{id}/activate`, `/v1/rewards/{id}/approve`
- Query parameters use `snake_case`
- Request and response bodies use `snake_case` for all field names
- Enum values use `snake_case` (e.g., `reward_type: "flat_cash"`, not `"FlatCash"`)

## 1.3 Versioning

The API is versioned via URL path prefix: `/v1`. A new major version (`/v2`) is introduced only when a breaking change is unavoidable. Within a version, the API evolves through additive changes only: new optional fields, new endpoints, new enum values. Clients must tolerate unknown fields in responses (open-world assumption).

Deprecation policy: any field or endpoint scheduled for removal is marked `deprecated: true` in the response body for a minimum of 6 months before removal. Deprecated fields continue to function during the grace period.

## 1.4 Idempotency Strategy

All state-mutating operations support idempotency. The mechanism differs between the Event Ingestion API and all other endpoints.

### Idempotency Comparison

| Concern | `/v1/events` (Ingestion) | All other `POST` endpoints |
|---------|--------------------------|----------------------------|
| **Idempotency key** | `external_id` field in the request body (mandatory) | `Idempotency-Key` HTTP header (mandatory on POST) |
| **Scope** | Per tenant | Per tenant + per key |
| **Dedup window** | 90 days | 24 hours |
| **Secondary dedup** | Yes — `referral_code + session_id + 5min_bucket` for SDK touch events | No secondary mechanism |
| **Duplicate response** | `200 OK` with `processing_status: "duplicate"` | Returns the original stored response (same status code as original) |
| **Key generation** | Client must generate a meaningful, stable ID (e.g., from their own event system) | Client generates an arbitrary ULID/UUID — no domain meaning required |
| **In-flight collision** | Accepted (event bus handles ordering) | `409 Conflict` with `Retry-After` header |
| **Why different?** | Events are high-throughput, arrive from unreliable sources (browsers), need domain-level dedup that survives retries across sessions | CRUD operations are lower-throughput, need request-level dedup to handle network retries |

The fundamental difference: event idempotency is **domain-level** (the same business event must never be recorded twice, regardless of how many times the HTTP request is retried), while CRUD idempotency is **request-level** (the same HTTP request must not create two resources).

### CRUD Idempotency Details

**Client-supplied idempotency key (required on POST):**

Every `POST` request that creates a resource must include an `Idempotency-Key` header. This is a client-generated string (recommended: ULID) that the server uses to deduplicate the request. The server stores the key alongside the response for 24 hours. If the same key is received again within that window, the server returns the stored response without re-executing the operation. The HTTP status code of the replayed response matches the original.

If the original request is still in flight when a duplicate arrives, the server returns `409 Conflict` with a `Retry-After` header.

**Natural idempotency (PUT, DELETE):**

`PUT` is inherently idempotent (it replaces the full resource state). `DELETE` is idempotent (deleting an already-deleted resource returns `204`). No additional idempotency key is required for these methods.

**PATCH:**

`PATCH` operations use JSON Merge Patch (RFC 7396). They require an `Idempotency-Key` header because partial updates are not naturally idempotent. The same key-based deduplication applies.

## 1.5 Pagination & Filtering

All list endpoints use **cursor-based pagination**. Offset pagination is not supported — it performs poorly on large datasets, produces inconsistent results when data changes between pages, and leaks information about total dataset size.

**Pagination parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Items per page. Default: 25. Maximum: 100. |
| `starting_after` | string | Cursor: return items after this ID (forward). |
| `ending_before` | string | Cursor: return items before this ID (backward). |

**Pagination response envelope:**

Every list response wraps results in a standard envelope:

```
{
  "data": [ ... ],
  "has_more": true,
  "next_cursor": "obj_xxx",
  "prev_cursor": "obj_yyy"
}
```

`has_more` indicates whether additional results exist in the requested direction. `next_cursor` and `prev_cursor` are present only when applicable.

**Filtering:**

Filters are expressed as query parameters. Simple equality filters use the field name directly: `?status=active`. Range filters use suffixed operators: `?created_at.gte=2026-01-01T00:00:00Z&created_at.lt=2026-02-01T00:00:00Z`. Supported suffixes: `.gte`, `.gt`, `.lte`, `.lt`.

Multi-value filters (OR semantics) use comma separation: `?status=active,paused`.

**Sorting:**

Sort is specified via `sort` parameter with optional `-` prefix for descending: `?sort=-created_at`. Default sort is `-created_at` (newest first) on all list endpoints unless otherwise specified.

**Expansion:**

Related resources can be inlined via the `expand` parameter to reduce round-trips: `?expand=campaign,variant`. Expandable relationships are documented per endpoint. Expansion depth is limited to one level — you cannot expand a resource on an already-expanded resource.

## 1.6 Error Model

All errors follow a consistent structure. The HTTP status code carries semantic meaning. The body provides machine-readable categorization and human-readable context.

**Error response structure:**

```
{
  "error": {
    "type": "invalid_request",
    "code": "segment_rule_invalid",
    "message": "Segment rule references undefined attribute 'plan_tier'.",
    "param": "segment.rules[0].attribute",
    "request_id": "req_abc123",
    "doc_url": "https://docs.referralai.com/errors/segment_rule_invalid"
  }
}
```

**Error types (top-level category):**

| Type | HTTP Status | Meaning |
|------|-------------|---------|
| `invalid_request` | 400 | Malformed request, validation failure, bad parameter |
| `authentication_error` | 401 | Missing or invalid credentials (API key or JWT) |
| `authorization_error` | 403 | Credentials valid but insufficient scope or wrong key type |
| `not_found` | 404 | Resource does not exist or is not accessible to this tenant |
| `conflict` | 409 | State conflict (e.g., activating an already-active campaign) |
| `idempotency_error` | 409 | Idempotency key collision with different request body |
| `gone` | 410 | Resource has been archived, campaign completed, or link expired |
| `unprocessable` | 422 | Semantically invalid (e.g., unknown campaign, campaign not yet active) |
| `rate_limit` | 429 | Rate limit exceeded |
| `internal_error` | 500 | Platform fault — retry safe |

**Validation errors** (400) may include a `details` array with per-field diagnostics when multiple fields fail validation simultaneously.

The `request_id` is present on every response (success or error) and must be included in support requests. It is also returned as the `X-Request-Id` response header.

## 1.7 Standard Response Headers

| Header | Purpose |
|--------|---------|
| `X-Request-Id` | Unique request identifier for tracing |
| `X-RateLimit-Limit` | Requests allowed per window |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when window resets |
| `ReferralAI-Tenant` | Tenant ID for the authenticated request |

## 1.8 Timestamp Format

All timestamps are ISO 8601 in UTC with millisecond precision: `2026-02-06T14:30:00.000Z`. The API accepts and returns this format exclusively. Timezone offsets are rejected — all times are UTC.

## 1.9 Currency

All monetary values are expressed as integers in the **minor unit** of the currency (cents for EUR, USD, etc.). A `currency` field (ISO 4217 three-letter code) always accompanies a monetary value. This avoids floating-point ambiguity.

```
{
  "amount": 1500,
  "currency": "EUR"
}
// Represents €15.00
```

---

# 2. Authentication & Authorization

## 2.1 Authentication Model Overview

The platform uses three authentication mechanisms, each serving a different caller type. Internally, all mechanisms resolve to the same JWT-based authorization context, ensuring uniform permission evaluation across all services.

```
┌──────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION MODEL                           │
│                                                                  │
│  EXTERNAL CALLERS                        INTERNAL CALLERS        │
│  ────────────────                        ─────────────────       │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐      ┌──────────────┐       │
│  │  API Keys    │  │  Dashboard   │      │   Client     │       │
│  │ (rai_live_,  │  │  Sessions    │      │ Credentials  │       │
│  │  rai_pub_)   │  │  (Ory Kratos)│      │  (OAuth2)    │       │
│  └──────┬───────┘  └──────┬───────┘      └──────┬───────┘       │
│         │                 │                      │               │
│  ═══════╪═════════════════╪══════════════════════╪═══════════    │
│         │        API GATEWAY (ALB + Traefik)     │               │
│         │           + NestJS Auth Guard          │               │
│  ═══════╪═════════════════╪══════════════════════╪═══════════    │
│         ▼                 ▼                      ▼               │
│  ┌──────────────────────────────────────────────────────┐       │
│  │              INTERNAL JWT                             │       │
│  │  { tenant_id, scopes, source, key_type, user_id }    │       │
│  │                                                       │       │
│  │  All downstream services receive the same JWT format  │       │
│  │  regardless of how the caller authenticated.          │       │
│  └──────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────┘
```

| Mechanism | Who Uses It | What Endpoints | How It Works |
|-----------|-------------|----------------|--------------|
| **API Keys** | Client backends, JS SDK, inbound webhooks (Stripe, etc.) | `/v1/events`, `/v1/events/batch`, `/v1/sdk/*` endpoints | Key sent as `Authorization: Bearer rai_xxx_...`. Gateway validates key, resolves tenant, exchanges for internal JWT. |
| **OAuth2 JWT (Ory Kratos session)** | Dashboard UI, client backend operators | All non-ingestion endpoints: Programs, Campaigns, Variants, Referrals, Rewards, Analytics, etc. | User authenticates via Ory Kratos (login). Session produces JWT. Gateway validates JWT and forwards. |
| **OAuth2 Client Credentials** | Internal batch processors, cron jobs, service-to-service calls | Internal service mesh | Machine-to-machine auth. No user context. Used for scheduled jobs (payout batches, segment recomputation, analytics aggregation, etc.). |

## 2.2 API Keys (External — Ingestion & SDK Only)

API keys are the authentication mechanism for event ingestion and SDK-facing endpoints. They are **not** used for CRUD operations on Programs, Campaigns, Rewards, or any configuration resource.

The platform issues two classes of API key:

| Key Type | Prefix | Purpose | Trust Level | Allowed Endpoints |
|----------|--------|---------|-------------|-------------------|
| **Secret key** | `rai_live_` | Client backend → ReferralAI event ingestion | High — must never be exposed to browsers or logs. | `POST /v1/events`, `POST /v1/events/batch` |
| **Publishable key** | `rai_pub_` | JS SDK, browser widgets | Low — safe to embed in frontend code. | `POST /v1/events` (touch only), `GET /v1/sdk/widget-config`, `POST /v1/sdk/enroll`, `GET /v1/sdk/resolve-link`, `POST /v1/sdk/attribution` |

**What API keys cannot do:** API keys cannot access Programs, Campaigns, Variants, Referrers, Referrals, Rewards, Payouts, Segments, Analytics, Webhooks, Recommendations, or Playbooks. Any attempt returns `403 authorization_error` with message "API keys are restricted to event ingestion and SDK endpoints. Use OAuth2 authentication for this resource."

**Key exchange at the gateway:**

When an API key request arrives at the gateway:

1. Auth Guard validates the key (lookup in Redis cache, fallback to PostgreSQL)
2. Resolves `tenant_id`, `key_type`, `scopes` from the key record
3. Verifies the requested endpoint is in the key's allowed set
4. Mints a short-lived internal JWT with claims: `{ tenant_id, source: "api_key", key_type: "secret"|"publishable", key_id, scopes }`
5. Forwards the request with the internal JWT to the downstream service

The downstream service only ever sees a JWT — it has no knowledge of API key formats or validation logic.

### API Key Scopes

Since API keys are restricted to ingestion and SDK endpoints, their scopes are narrow:

| Scope | Key Type | Grants |
|-------|----------|--------|
| `events:write` | Secret | Ingest all event types (touch, conversion, custom) |
| `events:write:touch` | Publishable | Ingest touch events only. Conversion and custom events rejected. |
| `sdk:read` | Publishable | Widget config, link resolution, attribution retrieval |
| `sdk:write` | Publishable | Self-enrollment (for open campaigns) |

### API Key Lifecycle

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/v1/api-keys` | POST | Create a new key (returns plaintext once) | OAuth2 JWT (dashboard) |
| `/v1/api-keys` | GET | List keys (returns masked values + `last_used_at`) | OAuth2 JWT (dashboard) |
| `/v1/api-keys/{id}` | DELETE | Revoke a key (immediate, irreversible) | OAuth2 JWT (dashboard) |

Key creation returns the full plaintext key exactly once. It is never stored in plaintext on the server and cannot be retrieved again. If lost, the key must be revoked and a new one created.

Key management endpoints require OAuth2 JWT authentication — you cannot create or revoke API keys using an API key.

## 2.3 OAuth2 JWT (Dashboard & Configuration API)

All non-ingestion, non-SDK endpoints require OAuth2 JWT authentication. JWTs are obtained through two paths:

**Path A — Dashboard session (interactive users):**

User authenticates via Ory Kratos (email/password, SSO, etc.). Ory Kratos issues a session. The frontend exchanges the session for a JWT via the gateway. The JWT carries: `{ tenant_id, user_id, role, scopes, source: "dashboard" }`.

Roles map to permission sets: Owner (full CRUD), Admin (full CRUD, no billing), Operator (create/edit campaigns, approve rewards), Viewer (read-only analytics).

**Path B — Client credentials (machine-to-machine, internal only):**

Internal services (batch processors, cron jobs, async workers) authenticate using OAuth2 client credentials flow. They call the token endpoint with `client_id` + `client_secret` and receive a JWT with: `{ tenant_id: "system"|specific_tenant, service_name, scopes, source: "client_credentials" }`.

Client credentials are **not** exposed to external client backends. They are an internal platform concern for service-to-service authentication.

### JWT Scopes (OAuth2)

Scopes follow a `resource:action` pattern and are assigned per user role or per service identity:

| Scope | Grants |
|-------|--------|
| `programs:read` | List and retrieve Programs |
| `programs:write` | Create, update, archive Programs |
| `campaigns:read` | List and retrieve Campaigns, Variants |
| `campaigns:write` | Create, update, activate, pause, complete Campaigns and Variants |
| `referrals:read` | List and retrieve Referrals |
| `referrers:read` | List and retrieve Referrer profiles |
| `referrers:write` | Register, update, block/unblock Referrers |
| `rewards:read` | List and retrieve Rewards |
| `rewards:write` | Approve, reject, clawback Rewards |
| `analytics:read` | Query attribution, KPIs, dashboards |
| `webhooks:read` | List and retrieve Webhook configurations |
| `webhooks:write` | Create, update, delete Webhook endpoints |
| `segments:read` | List and retrieve Segments |
| `segments:write` | Create, update, delete Segments |
| `payouts:read` | List and retrieve Payout batches |
| `payouts:write` | Initiate and confirm Payouts |

## 2.4 Tenant Isolation

Every authentication mechanism resolves to a `tenant_id` in the internal JWT. All queries are implicitly scoped to the tenant — there is no cross-tenant access, no superuser key for customers, and no endpoint that returns data across tenants. Tenant ID is derived from credentials; it cannot be overridden via header or parameter. Attempting to access a resource belonging to a different tenant returns `404`, not `403` — the resource is treated as nonexistent to prevent enumeration.

## 2.5 Authentication Summary by Endpoint Group

| Endpoint Group | API Key (rai_live_) | API Key (rai_pub_) | OAuth2 JWT (Dashboard) | OAuth2 Client Credentials |
|----------------|--------------------|--------------------|----------------------|--------------------------|
| `POST /v1/events` | ✅ All event types | ✅ Touch only | ❌ | ❌ |
| `POST /v1/events/batch` | ✅ | ❌ | ❌ | ❌ |
| `/v1/sdk/*` endpoints | ❌ | ✅ | ❌ | ❌ |
| Programs, Campaigns, Variants | ❌ | ❌ | ✅ | ✅ (internal batch) |
| Referrers, Referrals, Rewards | ❌ | ❌ | ✅ | ✅ (internal batch) |
| Analytics, Attribution | ❌ | ❌ | ✅ | ✅ (internal batch) |
| Webhooks, Segments | ❌ | ❌ | ✅ | ✅ (internal batch) |
| Payouts | ❌ | ❌ | ✅ | ✅ (internal batch) |
| API Key management | ❌ | ❌ | ✅ | ❌ |
| Magic Link micro-portal | ❌ | ❌ | ❌ | ❌ (token-based, see 3.15) |

---

# 3. Core Resources & Endpoints

All endpoints in this section require **OAuth2 JWT authentication** unless otherwise noted.

## 3.1 Program

### Purpose

A Program is the top-level organizational container for referral activity. It groups Campaigns, carries default configuration (attribution model, compliance settings), and is the unit at which health scoring and executive-level KPIs are computed.

Per the product spec: "One program per client" is the typical pattern, though the model supports multiple programs for clients running distinct referral strategies (e.g., partner channel vs. customer advocacy).

### Lifecycle

Programs have no state machine. A Program exists or is soft-deleted. Soft-deletion sets `archived_at` and cascades to all child Campaigns (which transition to `archived` state). Soft-deletion is irreversible. Soft-deleted Programs are excluded from list queries by default but can be retrieved by ID or by filtering `?include_archived=true`.

Branding (logo, colors, company name) is an account-level concern managed via account settings — not on the Program resource.

### Key Relationships

- Parent: Client Account (implicit from JWT tenant)
- Children: Campaigns (1..N)
- Computed: Health Score (read-only, AI-generated)
- Carries: Default attribution model, default attribution window

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| POST | `/v1/programs` | Create a new Program | `programs:write` |
| GET | `/v1/programs` | List all Programs for the tenant | `programs:read` |
| GET | `/v1/programs/{id}` | Retrieve a single Program | `programs:read` |
| PATCH | `/v1/programs/{id}` | Update Program configuration | `programs:write` |
| POST | `/v1/programs/{id}/archive` | Soft-delete a Program and cascade to all Campaigns | `programs:write` |
| GET | `/v1/programs/{id}/health` | Retrieve current Health Score and components | `analytics:read` |

**Request (POST /v1/programs):**

Fields: `name` (required), `description`, `default_attribution_model` (enum: `first_touch`, `last_touch`, `multi_touch_linear`, `ai_weighted`; default: `last_touch`), `default_attribution_window_days` (integer; default: 30), `metadata` (freeform key-value, max 50 keys).

**Response:**

Returns the full Program object including `id`, `created_at`, `updated_at`, `archived_at` (null), `health_score` (null until computed).

**Health Score response (GET /v1/programs/{id}/health):**

Returns the composite Program Health Score (0–100) with component breakdown per product spec:

```
{
  "score": 78,
  "components": {
    "conversion_rate": { "score": 85, "weight": 0.25, "value": "18%", "status": "good" },
    "reward_roi": { "score": 72, "weight": 0.20, "value": "4.2x", "status": "warning" },
    "fraud_rate": { "score": 95, "weight": 0.20, "value": "1.2%", "status": "good" },
    "referrer_engagement": { "score": 55, "weight": 0.15, "value": "22%", "status": "warning" },
    "attribution_quality": { "score": 88, "weight": 0.10, "value": "92%", "status": "good" },
    "trend_trajectory": { "score": 70, "weight": 0.10, "status": "stable" }
  },
  "computed_at": "2026-02-25T08:00:00.000Z"
}
```

**Expandable fields:** `campaigns` (latest 25), `health` (inline health score).

---

## 3.2 Campaign

### Purpose

A Campaign is the time-bound, goal-oriented execution unit. It selects a Pulse (workflow type), defines enrollment strategy, manages a shared budget, and manages lifecycle transitions through a defined state machine. The actual targeting, reward, and messaging configuration lives on its Variants.

### Key Design Decisions (from Product Spec v3.2)

1. **Enrollment model** is a Campaign-level setting: `open` (client intends to enroll all users — self-enrollment via widget is available) or `selective` (only pre-enrolled users via API/CSV/CRM see the widget).
2. **Every Campaign always has at least one Variant** — the **Default Variant**. If the client creates a simple campaign without defining additional variants, the system auto-creates a default variant. In multi-variant campaigns, one variant can be marked `is_default: true` to serve as a catch-all for referrers who don't match any other segment.
3. **Variant resolution happens at referrer enrollment** (link generation time), not at referee click. This ensures the referrer knows their reward amount when sharing.
4. **Budget** is shared at Campaign level — a total cap across all variants.

### Lifecycle (State Machine)

```
draft → scheduled → active → paused → active (resume)
                  → active → completed
draft → archived (cancel before launch)
active → completed → archived
paused → completed → archived
```

State transitions are explicit actions (not implicit from field updates). Each transition has its own endpoint.

### Key Relationships

- Parent: Program
- Children: Campaign Variants (1..N, always includes a Default Variant)
- Reference: Pulse (selected at creation, immutable)
- Spawns: Referrals (runtime workflow instances)

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| POST | `/v1/programs/{program_id}/campaigns` | Create a new Campaign (draft) | `campaigns:write` |
| GET | `/v1/programs/{program_id}/campaigns` | List Campaigns in a Program | `campaigns:read` |
| GET | `/v1/campaigns/{id}` | Retrieve a single Campaign (top-level shortcut) | `campaigns:read` |
| PATCH | `/v1/campaigns/{id}` | Update Campaign configuration (only in draft/paused) | `campaigns:write` |
| POST | `/v1/campaigns/{id}/schedule` | Schedule for future activation | `campaigns:write` |
| POST | `/v1/campaigns/{id}/activate` | Activate immediately | `campaigns:write` |
| POST | `/v1/campaigns/{id}/pause` | Pause an active Campaign | `campaigns:write` |
| POST | `/v1/campaigns/{id}/resume` | Resume a paused Campaign | `campaigns:write` |
| POST | `/v1/campaigns/{id}/complete` | Mark as completed (stops new referrals) | `campaigns:write` |
| POST | `/v1/campaigns/{id}/archive` | Archive (soft-delete) | `campaigns:write` |
| GET | `/v1/campaigns/{id}/stats` | Aggregate campaign KPIs | `analytics:read` |

**Request (POST /v1/programs/{program_id}/campaigns):**

Fields:

- `name` (required)
- `pulse` (required, enum: `signup`, `conversion`, `reactivation`, `cross_sell`, `renewal`, `feedback`, `product_education`, `switch_up`, `newsletter`) — immutable after creation
- `enrollment_model` (required, enum: `open`, `selective`) — `open` enables self-enrollment via the SDK widget; `selective` means only pre-enrolled referrers (via API, CSV, CRM, or auto-rules) see the widget
- `budget` (object, optional): `{ "total_amount": 1000000, "currency": "EUR" }` — total budget cap in minor units shared across all variants. Campaign pauses when budget is exhausted.
- `description`
- `starts_at` (ISO 8601, optional — if set, Campaign is created in `scheduled` state)
- `ends_at` (ISO 8601, optional)
- `attribution_window_days` (integer, optional — overrides Program default)
- `metadata`

When a Campaign is created, the platform automatically creates a **Default Variant** with the Campaign's basic settings. The client can then customize this variant or add more.

**State transition actions:**

Action endpoints accept an optional `reason` field for audit logging. Invalid transitions return `409 Conflict` with an error describing the current state and valid transitions from it.

**Response fields:**

`id`, `program_id`, `name`, `pulse`, `enrollment_model`, `status` (enum: `draft`, `scheduled`, `active`, `paused`, `completed`, `archived`), `budget` (object with `total_amount`, `currency`, `spent_amount`), `starts_at`, `ends_at`, `attribution_window_days`, `default_variant_id`, `variant_count`, `created_at`, `updated_at`, `metadata`.

**Filters on list:**

`?status=active,paused`, `?pulse=signup`, `?enrollment_model=open`, `?created_at.gte=...`, `?starts_at.lte=...`

**Expandable fields:** `variants`, `program`, `stats`.

---

## 3.3 Campaign Variant

### Purpose

The Variant is the core configuration unit within a Campaign. It binds a Segment (targeting audience), a Reward Configuration (incentive structure), and messaging into a single deployable unit. Multiple Variants on one Campaign enable comparing different configurations across the same or different audiences, with traffic distributed via deterministic hash-based allocation using `allocation_weight`.

### Default Variant

Every Campaign always has at least one Variant: the Default Variant. It is auto-created when the Campaign is created. In a single-variant campaign, the Default Variant holds all configuration. In a multi-variant campaign, the Default Variant acts as a catch-all for referrers who don't match any other variant's segment.

### Variant ↔ Segment Relationship

A **Segment** is a standalone, reusable definition of "who" — a set of rules that evaluate to true/false for any given actor. Segments exist independently and are managed via `/v1/segments`. They have no knowledge of Campaigns or Variants.

A **Campaign Variant** references exactly one Segment. The reference can be:

- **By ID** (`segment_id: "seg_xxx"`) — points to a shared, reusable Segment resource. Multiple Variants (even across different Campaigns) can reference the same Segment.
- **Inline** — the Variant embeds segment rules directly in its own configuration. This creates an implicit, one-off segment that is not reusable and not visible in `/v1/segments`.

The relationship is **many-to-one from Variants to Segments**: many Variants can reference the same Segment. A Variant always has exactly one Segment reference (or inline definition).

**Same-audience comparison:** When multiple Variants in the same Campaign reference the same Segment, `allocation_weight` determines how traffic is split. The Segment only answers "is this actor a member?" — the allocation logic is a Campaign-level concern resolved at enrollment time via deterministic hashing on `actor_id + campaign_id`.

**Different-audience targeting:** When Variants reference different Segments, each Variant targets its own audience. An actor who matches multiple Segments is assigned to the first matching Variant by priority order, with the Default Variant as the final fallback.

### Variant Resolution (at Enrollment Time)

Per product spec v3.2, variant resolution happens when a referrer enrolls (link generation time), not at referee click:

```
Referrer enrolled with attributes
  ↓
Evaluate against each variant's segment (in priority order)
  ↓
MATCH FOUND (one variant)     → Assign directly
MATCH FOUND (multiple)        → Highest priority wins; tie-break by allocation_weight
NO MATCH + default variant    → Assign default variant
NO MATCH + no default variant → Ineligible (no link generated)
```

This ensures the referrer knows their exact reward when sharing ("Share and earn €50") and all referees from one referrer's link land in the same variant.

### Lifecycle

Variants inherit their Campaign's lifecycle. A Variant can be individually enabled or disabled within an active Campaign, but it does not have its own state machine independent of the Campaign.

### Key Relationships

- Parent: Campaign
- References: Segment (by ID or inline definition)
- Contains: Reward Configuration, Messaging/Creative
- Produces: Variant-level KPIs (read-only)

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| POST | `/v1/campaigns/{campaign_id}/variants` | Create a new Variant | `campaigns:write` |
| GET | `/v1/campaigns/{campaign_id}/variants` | List Variants for a Campaign | `campaigns:read` |
| GET | `/v1/variants/{id}` | Retrieve a single Variant (top-level shortcut) | `campaigns:read` |
| PATCH | `/v1/variants/{id}` | Update Variant configuration | `campaigns:write` |
| POST | `/v1/variants/{id}/enable` | Enable variant (receives traffic) | `campaigns:write` |
| POST | `/v1/variants/{id}/disable` | Disable variant (stops receiving traffic) | `campaigns:write` |
| GET | `/v1/variants/{id}/stats` | Variant-level KPIs (incl. statistical significance) | `analytics:read` |

**Request (POST /v1/campaigns/{campaign_id}/variants):**

Fields:

- `name` (required): Human label (e.g., "Enterprise DE — €20 cash")
- `is_default` (boolean, default: false): Whether this variant is the catch-all. Only one variant per campaign can be default. Setting this to true on a new variant unsets it on the previous default.
- `priority` (integer, default: 0): Evaluation order for segment matching. Higher priority = evaluated first. Default variant should have lowest priority.
- `allocation_weight` (required, integer): Relative traffic weight. For a 50/50 split, both variants have weight 1. For 70/30, weights are 7 and 3. The platform normalizes weights across all enabled variants in the campaign.
- `segment` (required, object): Segment reference or inline definition.
  - By reference: `{ "segment_id": "seg_xxx" }`
  - Inline rule-based: `{ "type": "rule_based", "rules": [{ "attribute": "country", "operator": "eq", "value": "DE" }] }`
  - Inline composite: `{ "type": "composite", "combinator": "and", "rules": [...] }`
  - For default variant catch-all: `{ "type": "rule_based", "rules": [] }` (matches everyone)
- `reward_config` (required, object): See Reward Configuration schema below.
- `messaging` (object): `referrer_share_message`, `referee_landing_headline`, `referee_landing_body`, `email_templates` (object with template IDs per lifecycle event).
- `eligibility_rules` (array, optional): Additional eligibility checks beyond segment membership, evaluated at campaign entry, referral creation, conversion validation, and reward approval checkpoints.
- `enabled` (boolean, default: true)
- `metadata`

**Reward Configuration schema:**

```
{
  "reward_side": "double_side",           // single_side, double_side, referee_only
  "referrer_reward": {
    "type": "flat_cash",                  // flat_cash, percentage, tiered, milestone,
                                          // revenue_share, leaderboard
    "amount": 2000,                       // minor units (for flat types)
    "currency": "EUR",
    "percentage": null,                   // for percentage/revenue_share types
    "tiers": null,                        // for tiered type: [{ "min": 1, "max": 5, "amount": 1000 }, ...]
    "milestones": null,                   // for milestone type: [{ "count": 5, "bonus": 5000 }, ...]
    "revenue_share_duration_months": null, // for revenue_share: how long recurring commission lasts
    "cap_per_referrer": 50,               // max rewards per referrer per period
    "cap_period": "month"                 // day, week, month, campaign_lifetime
  },
  "referee_reward": {
    "type": "discount_percentage",
    "percentage": 20,
    "max_discount_amount": 5000,
    "currency": "EUR"
  },
  "approval_mode": "auto_below_threshold", // auto, manual, auto_below_threshold, ai_assisted
  "auto_approval_threshold": 5000,         // minor units — above this, manual required
  "fulfillment_mode": "instant",           // instant, batched, manual, integration
  "clawback_window_days": 30,
  "cooling_period_days": 0                 // delay before reward becomes eligible for approval
}
```

**Response fields (on GET):**

`id`, `campaign_id`, `name`, `is_default`, `priority`, `allocation_weight`, `segment` (object or reference), `reward_config`, `messaging`, `eligibility_rules`, `enabled`, `created_at`, `updated_at`, `metadata`.

**Expandable fields:** `campaign`, `segment`, `stats`.

---

## 3.4 Segment

### Purpose

Segments define target audiences for Campaign Variants. They are reusable — a single Segment can be referenced by multiple Variants across multiple Campaigns. Segments can also be defined inline on a Variant for one-off use (in which case they are not visible as standalone resources).

Segmentation is the sole audience allocation mechanism in the platform. There is no separate experimentation or A/B testing framework. Random segments (hash-based deterministic allocation) serve that purpose. When the same Segment is referenced by multiple Variants, traffic distribution is handled by the `allocation_weight` on each Variant — not by the Segment itself.

### Segment Types

Per product spec v2.0:

| Type | Description | Evaluation |
|------|-------------|------------|
| `rule_based` | Manual rules defined by operator | Real-time |
| `behavioral` | Action-history based (event counts, recency) | Batch or real-time |
| `temporal` | Time-attribute based (signup date, account age) | Real-time |
| `composite` | AND/OR combinations of other rules | Real-time |
| `random` | Hash-based deterministic allocation | Real-time |
| `ai_generated` | Patterns detected by AI (read-only to clients) | Batch (daily) |

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| POST | `/v1/segments` | Create a reusable Segment | `segments:write` |
| GET | `/v1/segments` | List Segments | `segments:read` |
| GET | `/v1/segments/{id}` | Retrieve a Segment | `segments:read` |
| PATCH | `/v1/segments/{id}` | Update Segment definition | `segments:write` |
| DELETE | `/v1/segments/{id}` | Delete (only if not in use by active Variants) | `segments:write` |
| GET | `/v1/segments/{id}/estimate` | Estimate audience size | `segments:read` |
| GET | `/v1/segments/{id}/variants` | List Variants referencing this Segment | `segments:read` + `campaigns:read` |

**Request (POST /v1/segments):**

Fields:

- `name` (required)
- `type` (required, enum: `rule_based`, `behavioral`, `temporal`, `composite`, `random`, `ai_generated`)
- `rules` (required for `rule_based` and `composite`): Array of rule objects.
  - Rule: `{ "attribute": "country", "operator": "eq", "value": "DE" }`
  - Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `contains`, `exists`
  - Composite rules support `"combinator": "and"` or `"combinator": "or"` with nested `rules` arrays.
- `behavioral_config` (for `behavioral` type): `{ "event_type": "purchase", "count_operator": "gte", "count_value": 3, "time_window_days": 90 }`
- `temporal_config` (for `temporal` type): `{ "attribute": "created_at", "operator": "gte", "relative_days": -30 }`
- `random_config` (for `random` type): `{ "percentage": 50, "seed": "campaign_123_2024", "sticky": true, "mutual_exclusion_group": "reward_test" }`
- `description`, `metadata`

The `ai_generated` type is read-only from the client's perspective — these segments are created by the AI subsystem and surfaced for review.

**Delete protection:** A Segment referenced by any active (non-archived) Variant cannot be deleted. The API returns `409 Conflict` listing the Variants that reference it.

---

## 3.5 Referrer

### Purpose

Referrers are external actors who share referral links. They do **not** have platform accounts, no dashboard, no login. They interact exclusively via referral links, embedded widgets, emails, and magic links (token-based micro-portal). The API provides CRUD and management access to referrer records.

### Enrollment

Referrers are registered in the platform by the client — not acquired by the platform itself. Enrollment methods:

| Method | Endpoint | Phase |
|--------|----------|-------|
| API Single | `POST /v1/referrers` | MVP |
| API Bulk | `POST /v1/referrers/batch` (up to 1000) | MVP |
| CSV Import | Dashboard upload (calls API internally) | Lot 1 |
| CRM Connector | HubSpot/Salesforce integration | Lot 1 |
| Auto-Enrollment Rules | Event-triggered (configured in dashboard) | Lot 1 |
| SDK Widget Self-Enrollment | For `open` enrollment campaigns only | MVP |

### Lifecycle & Trust Evolution

Per product spec v2.0, referrers evolve through trust tiers based on cumulative behavior:

```
Unknown → New → Trusted → Ambassador → (Partner)
                    ↘ Flagged → Blocked
```

| Trust Tier | Score Range | Privileges |
|------------|-------------|------------|
| `unknown` | 0 | Initial state, no activity yet |
| `new` | 1–25 | Low payout limits, longer hold periods, full fraud checks |
| `trusted` | 26–60 | Standard limits, standard processing |
| `ambassador` | 61–100 | High limits, priority processing, auto-approval |
| `flagged` | N/A | Under fraud review, rewards held |
| `blocked` | N/A | Permanently blocked, no referrals |

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| POST | `/v1/referrers` | Register a single Referrer | `referrers:write` |
| POST | `/v1/referrers/batch` | Register up to 1000 Referrers | `referrers:write` |
| GET | `/v1/referrers` | List Referrers | `referrers:read` |
| GET | `/v1/referrers/{id}` | Retrieve a Referrer | `referrers:read` |
| PATCH | `/v1/referrers/{id}` | Update metadata, tags | `referrers:write` |
| POST | `/v1/referrers/{id}/block` | Block a Referrer (disables all links) | `referrers:write` |
| POST | `/v1/referrers/{id}/unblock` | Unblock a Referrer | `referrers:write` |
| GET | `/v1/referrers/{id}/links` | List active referral links for this Referrer | `referrers:read` |
| POST | `/v1/referrers/{id}/links` | Generate a new referral link for a Campaign | `referrers:write` |
| GET | `/v1/referrers/{id}/stats` | Referrer-level KPIs | `analytics:read` |
| GET | `/v1/referrers/{id}/rewards` | List Rewards earned by this Referrer | `rewards:read` |

**Request (POST /v1/referrers):**

Fields: `email` (required), `name`, `external_id` (client's internal identifier — used for deduplication), `campaign_id` (optional — auto-enrolls in campaign and triggers variant resolution + link generation), `tags` (array of strings), `attributes` (object — used for segment evaluation: `{ "plan": "enterprise", "country": "DE", "mrr": 500 }`), `metadata`.

If a Referrer with the same `email` or `external_id` already exists, the endpoint returns the existing Referrer (idempotent by natural key). No duplicate is created.

**Request (POST /v1/referrers/batch):**

Fields: `referrers` (required, array, max 1000): Each item has the same schema as the single referrer request. `campaign_id` (optional, applied to all): Auto-enroll all referrers in this campaign.

Response: Per-item results (same pattern as batch events).

**Request (POST /v1/referrers/{id}/links):**

Fields: `campaign_id` (required), `channel` (optional, enum: `link`, `email`, `widget`, `api`), `custom_slug` (optional — vanity slug), `metadata`.

When a link is generated, the platform resolves the referrer's variant assignment for that campaign (segment evaluation → variant match → assignment stored). The link is bound to the resolved variant.

Returns: `{ "link_url": "https://ref.client.com/r/abc123", "referral_code": "abc123", "variant_id": "...", "campaign_id": "...", "expires_at": "..." }`

**Response fields (on GET):**

`id`, `email`, `name`, `external_id`, `status` (enum: `active`, `blocked`), `trust_score` (0–100, AI-computed, read-only), `fraud_score` (0–1, AI-computed, read-only), `trust_tier` (enum: `unknown`, `new`, `trusted`, `ambassador`, `flagged`, `blocked`), `attributes`, `total_referrals`, `total_conversions`, `total_rewards_earned` (monetary summary), `created_at`, `updated_at`, `tags`, `metadata`.

**Filters on list:** `?status=active`, `?trust_tier=trusted,ambassador`, `?campaign_id=xxx`, `?created_at.gte=...`, `?tag=vip`

---

## 3.6 Referral

### Purpose

A Referral is the runtime workflow instance (orchestrated by Temporal) — the record of a specific Referrer → Referee connection within a Campaign context. Referrals are created automatically when a Referee interacts with a referral link (touch event) or can be created explicitly via API for integrations that bypass the link flow.

### Lifecycle (State Machine)

Per product spec v2.0:

```
┌───────────┐   touch    ┌───────────┐  eligible   ┌───────────┐
│  CREATED  │──recorded─▶│ QUALIFIED │───────────▶│ CONVERTED │
└───────────┘            └─────┬─────┘            └─────┬─────┘
                               │                        │
                          not eligible             fraud clean
                               │                        │
                         ┌─────▼─────┐            ┌─────▼─────┐
                         │ REJECTED  │            │ REWARDED  │
                         └───────────┘            └───────────┘
                               ▲                        │
                          fraud confirmed          clawback
                               │                        │
                               └────────────────  ┌─────▼─────┐
                                                  │CLAWED BACK│
                                                  └───────────┘
     ┌───────────┐
     │  EXPIRED  │ ← attribution window passed without conversion
     └───────────┘
```

**What is `clawed_back`?** A clawback is the reversal of an already-fulfilled reward. It occurs when a conversion that triggered a reward is later invalidated — e.g., the referee's payment is charged back, a refund is processed within the clawback window, or fraud is confirmed post-fulfillment. Creates a negative balance against the referrer's future payouts.

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| POST | `/v1/referrals` | Explicitly create a Referral (server-side tracking) | `referrals:read` + `referrers:write` |
| GET | `/v1/referrals` | List Referrals | `referrals:read` |
| GET | `/v1/referrals/{id}` | Retrieve a single Referral with workflow state | `referrals:read` |
| POST | `/v1/referrals/{id}/reject` | Manually reject a Referral | `referrals:read` + `rewards:write` |
| GET | `/v1/referrals/{id}/touches` | List Touch events for this Referral | `referrals:read` |
| GET | `/v1/referrals/{id}/attribution` | Retrieve attribution computation | `analytics:read` |
| GET | `/v1/referrals/{id}/rewards` | List Rewards associated with this Referral | `rewards:read` |

**Request (POST /v1/referrals):**

Fields: `referrer_id` (required), `referee_email` (required), `campaign_id` (required), `external_id` (required — idempotency key), `referee_external_id` (optional — client's identifier for the referee), `metadata`.

**Response fields (on GET):**

`id`, `referrer_id`, `referee_email`, `referee_external_id`, `campaign_id`, `variant_id`, `status` (enum: `created`, `qualified`, `converted`, `rewarded`, `rejected`, `clawed_back`, `expired`), `referral_code`, `first_touch_at`, `last_touch_at`, `converted_at`, `touch_count`, `fraud_signals` (array of signal objects), `created_at`, `updated_at`, `metadata`.

**Filters on list:** `?campaign_id=xxx`, `?referrer_id=xxx`, `?status=converted,rewarded`, `?created_at.gte=...`, `?variant_id=xxx`

**Expandable fields:** `referrer`, `campaign`, `variant`, `rewards`, `touches`, `attribution`.

---

## 3.7 Event

### Purpose

Events are the foundational data primitive. They are immutable, timestamped records of things that happened. The Event Ingestion API is the primary integration point for client backends. Events are covered in depth in Section 5. This section covers the read API only.

### Endpoints

| Method | Path | Intent | Auth | Scopes |
|--------|------|--------|------|--------|
| POST | `/v1/events` | Ingest one or more events | API Key | `events:write` |
| POST | `/v1/events/batch` | Ingest a batch of events (up to 100) | API Key (secret only) | `events:write` |
| GET | `/v1/events` | List events (with filters) | OAuth2 JWT | `analytics:read` |
| GET | `/v1/events/{id}` | Retrieve a single event | OAuth2 JWT | `analytics:read` |

**Response fields (on GET):**

`id`, `external_id`, `type` (enum: `touch`, `conversion`, `custom`), `event_name`, `actor_type` (enum: `referrer`, `referee`, `system`), `actor_id`, `referral_id` (if resolved), `campaign_id` (if resolved), `variant_id` (if resolved), `properties`, `context` (object: `ip_hash`, `user_agent`, `country`, `device_type`), `consent_status`, `occurred_at`, `ingested_at`, `processing_status` (enum: `accepted`, `processed`, `failed`, `duplicate`).

**Filters on list:** `?type=conversion`, `?event_name=user.signup_completed`, `?referral_id=xxx`, `?campaign_id=xxx`, `?occurred_at.gte=...`, `?processing_status=failed`

---

## 3.8 Reward

### Purpose

A Reward is a runtime instance created when a Referral's conversion triggers reward evaluation. The Reward inherits its rules from the Variant's Reward Configuration but has its own lifecycle from creation through fulfillment (or rejection/clawback).

### Lifecycle

```
earned → pending_approval → approved → fulfillment_initiated → fulfilled
                         → rejected
                                                             → clawed_back
```

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| GET | `/v1/rewards` | List Rewards | `rewards:read` |
| GET | `/v1/rewards/{id}` | Retrieve a single Reward | `rewards:read` |
| POST | `/v1/rewards/{id}/approve` | Manually approve a pending Reward | `rewards:write` |
| POST | `/v1/rewards/{id}/reject` | Reject a pending Reward | `rewards:write` |
| POST | `/v1/rewards/{id}/clawback` | Initiate clawback of a fulfilled Reward | `rewards:write` |

**Response fields (on GET):**

`id`, `referral_id`, `referrer_id`, `campaign_id`, `variant_id`, `recipient_type` (enum: `referrer`, `referee`), `reward_type` (enum: `flat_cash`, `percentage`, `discount_percentage`, `discount_fixed`, `credit`, `non_monetary`, `revenue_share`, `milestone`, `leaderboard`), `amount` (minor units), `currency`, `status` (enum: `earned`, `pending_approval`, `approved`, `rejected`, `fulfillment_initiated`, `fulfilled`, `clawed_back`), `approval_mode_used`, `approved_by` (user ID or `system`), `fulfilled_at`, `clawback_reason`, `clawback_initiated_at`, `created_at`, `updated_at`, `metadata`.

**Request (POST /v1/rewards/{id}/clawback):**

Fields: `reason` (required — logged in immutable audit trail), `amount` (optional — for partial clawback; defaults to full amount).

**Filters on list:** `?status=pending_approval`, `?referrer_id=xxx`, `?campaign_id=xxx`, `?recipient_type=referrer`, `?reward_type=flat_cash`, `?created_at.gte=...`, `?amount.gte=1000`

**Expandable fields:** `referral`, `referrer`, `campaign`, `variant`.

---

## 3.9 Attribution (Read-Only)

### Purpose

Attribution records document how credit for a Conversion was assigned to one or more Referrers. They are computed by the Attribution Engine after a conversion event is processed and are strictly read-only.

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| GET | `/v1/attributions` | List attribution records | `analytics:read` |
| GET | `/v1/attributions/{id}` | Retrieve a single attribution record | `analytics:read` |

**Response fields:**

`id`, `referral_id`, `conversion_event_id`, `model_used` (enum: `first_touch`, `last_touch`, `multi_touch_linear`, `ai_weighted`), `window_days`, `touches` (array of touch summaries, each with `touch_id`, `referrer_id`, `channel`, `occurred_at`, `credit_weight` as a decimal 0–1), `total_attributed_revenue` (minor units), `currency`, `computed_at`, `confidence` (0–1, for AI-weighted only).

**Filters:** `?referral_id=xxx`, `?campaign_id=xxx`, `?model_used=ai_weighted`, `?computed_at.gte=...`

---

## 3.10 Payout

### Purpose

Payouts are batched disbursements to Referrers. The platform accumulates approved Rewards and groups them into Payout batches, either on a schedule or on-demand.

### Lifecycle

```
pending → processing → completed
                    → partially_failed
                    → failed
```

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| GET | `/v1/payouts` | List Payout batches | `payouts:read` |
| GET | `/v1/payouts/{id}` | Retrieve a single Payout batch | `payouts:read` |
| POST | `/v1/payouts` | Create a new Payout batch (on-demand) | `payouts:write` |
| POST | `/v1/payouts/{id}/confirm` | Confirm a pending Payout for processing | `payouts:write` |
| POST | `/v1/payouts/{id}/cancel` | Cancel a pending Payout before processing | `payouts:write` |
| GET | `/v1/payouts/{id}/items` | List individual payout line items | `payouts:read` |

**Request (POST /v1/payouts):**

Fields: `campaign_ids` (optional), `referrer_ids` (optional), `min_amount` (optional), `fulfillment_method` (required, enum: `stripe_connect`, `paypal`, `bank_transfer`, `sepa`, `gift_card`, `credit`), `description`, `metadata`.

The Payout is created in `pending` state and must be explicitly confirmed before funds are disbursed (two-step process).

---

## 3.11 Playbooks (Read-Only Templates)

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| GET | `/v1/playbooks` | List available Playbooks | `campaigns:read` |
| GET | `/v1/playbooks/{id}` | Retrieve a Playbook with full template | `campaigns:read` |
| POST | `/v1/playbooks/{id}/instantiate` | Create a Campaign from a Playbook | `campaigns:write` |

**Response fields (on GET):**

`id`, `name`, `description`, `vertical` (enum: `saas`, `agency`, `creator`), `pulse`, `variant_templates` (array of variant configuration templates with default reward configs, segment presets, messaging), `recommended_for`, `reward_campaign_compatibility` (per the Reward–Campaign Compatibility Matrix from product spec), `created_at`, `updated_at`.

**Request (POST /v1/playbooks/{id}/instantiate):**

Fields: `program_id` (required), `enrollment_model` (required), `overrides` (optional), `name` (optional).

Returns: A Campaign in `draft` state with Default Variant populated from the Playbook.

---

## 3.12 AI Recommendations (Read-Only)

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| GET | `/v1/recommendations` | List pending recommendations | `analytics:read` |
| GET | `/v1/recommendations/{id}` | Retrieve with explanation | `analytics:read` |
| POST | `/v1/recommendations/{id}/accept` | Accept and apply | `campaigns:write` or `rewards:write` |
| POST | `/v1/recommendations/{id}/dismiss` | Dismiss (logged for AI feedback) | `analytics:read` |

**Response fields:**

`id`, `type` (enum: `reward_optimization`, `segment_suggestion`, `variant_conclusion`, `campaign_timing`, `fraud_investigation`, `health_alert`), `severity` (enum: `info`, `warning`, `critical`), `title`, `description`, `explanation`, `recommended_action` (structured object), `affected_resources`, `status` (enum: `pending`, `accepted`, `dismissed`, `expired`), `created_at`, `expires_at`.

---

## 3.13 Analytics Endpoints

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| GET | `/v1/analytics/kpis` | Computed KPIs at account level | `analytics:read` |
| GET | `/v1/analytics/funnel` | Referral funnel (touches → conversions → rewards) | `analytics:read` |
| GET | `/v1/analytics/revenue` | Attributed revenue over time | `analytics:read` |
| GET | `/v1/analytics/referrers/leaderboard` | Top referrers by selected metric | `analytics:read` |

**Common query parameters:** `period`, `from`, `to`, `program_id`, `campaign_id`, `variant_id`, `group_by`.

KPI hierarchy follows product spec: Business KPIs → Program KPIs → Campaign KPIs → Variant KPIs → Referrer KPIs → Quality KPIs.

---

## 3.14 GDPR Erasure Requests

### Purpose

Consent capture itself is not a standalone API resource — consent status is a field on touch events, captured from the browser via CMP integration by the JS SDK. The API exposes only the **erasure flow**.

### Endpoints

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| POST | `/v1/erasure-requests` | Submit a GDPR erasure request | `referrers:write` |
| GET | `/v1/erasure-requests/{id}` | Check erasure request status | `referrers:read` |

**Request (POST /v1/erasure-requests):**

Fields: `actor_email` (required), `actor_type` (enum: `referrer`, `referee`), `reason` (optional).

Returns: `{ "id": "...", "status": "pending", "estimated_completion": "..." }`. Processed within 30 days per GDPR.

---

## 3.15 Magic Link Micro-Portal (Token-Based)

### Purpose

Referrers have no platform login. They access a read-only micro-portal via magic links sent in emails. The portal shows their referral stats, reward status, and sharing tools. Authentication is via a short-lived, signed token embedded in the URL — no OAuth2, no API keys.

### Endpoints

These endpoints use **token-based authentication** (signed JWT in the URL query parameter). Tokens are generated by the platform when sending emails to referrers. Tokens are single-use or time-limited (24 hours), read-only, and scoped to a single referrer.

| Method | Path | Intent | Auth |
|--------|------|--------|------|
| GET | `/v1/portal/summary` | Referrer's dashboard: stats, rewards, sharing tools | Token (`?token=xxx`) |
| GET | `/v1/portal/rewards` | List referrer's rewards with status | Token (`?token=xxx`) |
| GET | `/v1/portal/links` | List referrer's active links with sharing tools | Token (`?token=xxx`) |

**Response (GET /v1/portal/summary):**

```
{
  "referrer_name": "Alice",
  "referrals_sent": 12,
  "conversions": 4,
  "rewards_earned": { "amount": 12000, "currency": "EUR" },
  "rewards_pending": { "amount": 3000, "currency": "EUR" },
  "active_campaigns": [
    { "campaign_id": "...", "campaign_name": "Q1 Growth", "referral_link": "...", "share_message": "..." }
  ]
}
```

**Token validation:** The platform verifies the signature (HMAC-SHA256), checks expiration (24h), and resolves the referrer. Invalid or expired tokens return `401`. Tokens cannot be used to write data or access other referrers' information.

---

# 4. SDK & Widget Endpoints (Publishable Key)

## 4.1 Overview

These endpoints are called by the JS SDK running in the client's website/app. They are authenticated via **publishable API key** (`rai_pub_`). They serve three purposes:

1. **Widget initialization** — determine what widget to render for the current user
2. **Self-enrollment** — allow users to become referrers in open campaigns
3. **Link resolution** — resolve referral codes when a referee clicks a link
4. **Attribution retrieval** — provide attribution data for the client's frontend to pass to their backend

These endpoints are lightweight, latency-sensitive, and must handle high concurrency from browser requests.

## 4.2 Widget Configuration

**Endpoint:** `GET /v1/sdk/widget-config`

**Auth:** Publishable key (`rai_pub_`)

**Purpose:** Called by the SDK on page load (after `RefRev.init()`) to determine what widget to render for the current user. The platform checks the user's enrollment status and returns the appropriate widget behavior.

**Query parameters:**

- `campaign_id` (required): Which campaign's widget to render
- `user_id` (required): Client's internal user ID (passed in SDK `init()`)

**Response depends on user status:**

**Case 1: Enrolled referrer for this campaign**

```
{
  "status": "enrolled",
  "referrer_id": "ref_abc",
  "variant_id": "var_a_enterprise",
  "referral_link": "https://ref.acme.com/r/ALICE123",
  "referral_code": "ALICE123",
  "widget_config": {
    "mode": "active_referrer",
    "headline": "Share and earn €50 per referral",
    "share_message": "Try Acme — use my link for 20% off!",
    "show_stats": true,
    "stats": {
      "referrals_sent": 3,
      "conversions": 1,
      "rewards_earned": { "amount": 5000, "currency": "EUR" }
    }
  }
}
```

**Case 2: Not enrolled, campaign is `open` (self-enrollment available)**

```
{
  "status": "not_enrolled",
  "enrollment_model": "open",
  "widget_config": {
    "mode": "enrollment_cta",
    "headline": "Love Acme? Refer friends and earn rewards!",
    "cta_text": "Start Referring",
    "reward_preview": "Earn €15 for every friend who signs up"
  }
}
```

**Case 3: Not enrolled, campaign is `selective`**

```
{
  "status": "not_enrolled",
  "enrollment_model": "selective",
  "widget_config": {
    "mode": "hidden"
  }
}
```

**Case 4: Enrolled but blocked/suspended**

```
{
  "status": "blocked",
  "widget_config": {
    "mode": "hidden"
  }
}
```

If `user_id` is not provided, the SDK does not render the widget and logs a console warning. The integration health dashboard flags repeated SDK loads without `user_id`.

## 4.3 Self-Enrollment

**Endpoint:** `POST /v1/sdk/enroll`

**Auth:** Publishable key (`rai_pub_`)

**Purpose:** Called when a user clicks the "Start Referring" CTA in the widget for an `open` enrollment campaign. Registers the user as a referrer, resolves their variant, generates their link, and returns the active-referrer widget config.

**Request:**

```
{
  "campaign_id": "camp_xxx",
  "user_id": "client_user_123",
  "user_email": "alice@example.com",
  "user_name": "Alice"
}
```

**Response:** Same as the "enrolled referrer" widget config response (Case 1 above).

**Validation:**

- Campaign must be `active` and `enrollment_model: "open"`
- `user_id` and `user_email` required
- If user is already enrolled, returns existing enrollment (idempotent)
- If campaign is `selective`, returns `403`

## 4.4 Referral Link Resolution

**Endpoint:** `GET /v1/sdk/resolve-link`

**Auth:** Publishable key (`rai_pub_`)

**Purpose:** Called by the SDK when it detects a `?ref=` parameter in the URL. Resolves the referral code to campaign/referrer context and returns data needed for cookie setup and touch recording.

**Query parameters:**

- `referral_code` (required): The code from the URL

**Response:**

```
{
  "valid": true,
  "referral_code": "ALICE123",
  "campaign_id": "camp_xxx",
  "referrer_id": "ref_abc",
  "campaign_active": true,
  "cookie_ttl_days": 30,
  "referee_reward_preview": "Get 20% off your first purchase"
}
```

If the code is invalid, expired, or the campaign is not active:

```
{
  "valid": false,
  "reason": "link_expired"    // "link_expired", "campaign_ended", "referrer_blocked", "unknown_code"
}
```

The SDK uses this response to decide whether to set cookies and begin tracking.

## 4.5 Attribution Retrieval

**Endpoint:** `POST /v1/sdk/attribution`

**Auth:** Publishable key (`rai_pub_`)

**Purpose:** Called by the client's frontend to retrieve the current attribution context for the user. The frontend passes this data to the client's backend, which then includes it in server-side event submissions.

This replaces the `RefRev.getAttribution()` SDK method with a server-validated version. The SDK calls this endpoint and returns the result to the frontend code.

**Request:**

```
{
  "session_id": "sess_xxx",
  "referral_code": "ALICE123"
}
```

**Response:**

```
{
  "ref_code": "ALICE123",
  "click_id": "clk_xyz789",
  "session_id": "sess_xxx",
  "campaign_id": "camp_xxx"
}
```

Returns `null` fields if no attribution context is found.

---

# 5. Event Ingestion API

## 5.1 Overview

The Event Ingestion API (`/v1/events`) is the highest-throughput endpoint on the platform. It receives behavioral, lifecycle, and conversion signals from client backends and the JS SDK. This endpoint and `/v1/sdk/*` are the only endpoint groups that accept API key authentication.

**Latency SLA:** < 100ms response (accept/reject).

## 5.2 Endpoint Definitions

| Method | Path | Intent | Key Type |
|--------|------|--------|----------|
| POST | `/v1/events` | Ingest a single event | Secret or Publishable (restricted) |
| POST | `/v1/events/batch` | Ingest up to 100 events in one request | Secret only |

## 5.3 Event Schema

Every event must include:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `external_id` | string | Yes | Client-generated unique identifier. Primary deduplication key. Max 256 characters. |
| `type` | enum | Yes | `touch`, `conversion`, `custom` |
| `event_name` | string | Yes | Dot-notation event name (e.g., `user.signup_completed`, `subscription.created`, `page.viewed`). Must match `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`, max 128 characters. |
| `occurred_at` | ISO 8601 | Yes | When the event occurred. Not in future (5min tolerance). Not older than 7 days (touch) or 30 days (conversion). |
| `properties` | object | No | Freeform key-value pairs. Max 50 keys, 10KB total. |

**Additional fields per type:**

For `touch` events:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_code` | string | Yes | The referral code from the link |
| `channel` | enum | No | `link`, `widget`, `email`, `api` |
| `consent_status` | enum | Yes | `granted`, `denied`, `unknown` — captured from CMP by the SDK |
| `session_id` | string | No | SDK-generated session identifier (stored in `_rai_sid` cookie) |
| `context` | object | No | `{ "page_url": "..." }`. `ip_hash` and `user_agent` derived server-side for publishable key requests. |

For `conversion` events:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referee_email` | string | Conditional | Required if `referee_external_id` not provided. |
| `referee_external_id` | string | Conditional | Required if `referee_email` not provided. |
| `referral_code` | string | No | If known, enables direct linkage. |
| `consent_status` | enum | No | Trusted from secret keys. |
| `revenue` | object | No | `{ "amount": 4900, "currency": "EUR", "type": "one_time"|"recurring", "mrr": 4900 }` |

For `custom` events: `external_id`, `type`, `event_name`, `occurred_at`, `properties`, optional `actor_email` or `actor_external_id`.

## 5.4 Deduplication

**Primary:** `external_id` scoped to tenant. 90-day window. Duplicates return `200 OK` with `processing_status: "duplicate"`.

**Secondary (SDK touch events):** `referral_code + session_id + 5min_bucket`. Prevents reload/retry double-counting.

## 5.5 Batching

`/v1/events/batch`: max 100 events, max 1MB body. Each event processed independently. Per-item status in response. HTTP `200 OK` for the batch; individual failures communicated per-item.

## 5.6 Trust Boundaries

| Source | Key Type | Trust Level | Validation |
|--------|----------|-------------|------------|
| Client backend | Secret (`rai_live_`) | High | All event types. Revenue trusted. Context trusted. |
| JS SDK / Browser | Publishable (`rai_pub_`) | Low | Touch only. No conversion. No revenue. `ip_hash`/`user_agent` derived server-side. |

A publishable key submitting a conversion event receives `403 Forbidden`.

## 5.7 Business Rules Guard

Per product spec v2.0 (Section 10.2), before an event reaches the workflow runtime, business rules reject obviously invalid events early:

| Check | Invalid State | Response |
|-------|--------------|----------|
| Campaign exists? | No | `422: "Unknown campaign"` |
| Campaign archived? | Yes | `410: "Campaign archived"` |
| Campaign completed? | Yes | `410: "Campaign completed"` |
| Campaign paused? | Touch events → `202 Accepted` (buffered for resume). Conversions for existing referrals → `202 Accepted`. New referral creation → blocked. | Conditional |
| Campaign scheduled, before `starts_at`? | Yes | `422: "Campaign not yet active"` |
| Campaign scheduled, after `ends_at`? | Yes | `410: "Campaign ended"` |
| Referral link expired? | Yes | `410: "Link expired"` |
| Referral link revoked? | Yes | `403: "Link revoked"` |

**Paused campaign nuance:** Touch events during pause are buffered because the referrer doesn't know the campaign is paused. Conversion events proceed for existing referrals. Only new referral creation is blocked.

## 5.8 Business Rate Limiting

Per product spec v2.0 (Section 10.3):

| Level | Limit | Purpose |
|-------|-------|---------|
| Per API key | 10,000 touch events/min per publishable key | Prevent SDK abuse |
| Per referral code | 100 touches/hour per code | Detect link farming |
| Per IP | 50 touch events/min per IP hash | Prevent single-source flooding |
| Per tenant | Configurable (based on plan) | Fair usage |

Rate limit exceeded events feed the fraud detection pipeline.

## 5.9 Processing Pipeline

```
Ingestion (sync, <100ms) → Validation & Dedup → Business Rules Guard → Enrich → Emit to SNS/SQS
                                                                                        │
                        ┌───────────────────────────────────────────────────────────────┘
                        ▼
                 Referral Workflow Runtime (Temporal, async, seconds to minutes)
                 ├─ Route to existing Referral workflow (or create new)
                 ├─ Variant resolution (segment eval + allocation)
                 ├─ Eligibility check
                 ├─ Referral state transition
                 ├─ Conversion validation
                 ├─ Fraud evaluation
                 ├─ Reward evaluation
                 └─ Fulfillment trigger
```

The sync portion returns `202 Accepted`. Downstream processing is eventually consistent. Subscribe to webhooks for `referral.converted`, `reward.earned`, etc.

---

# 6. Webhooks (Outbound API)

## 6.1 Configuration

| Method | Path | Intent | Scopes |
|--------|------|--------|--------|
| POST | `/v1/webhooks` | Register a new webhook endpoint | `webhooks:write` |
| GET | `/v1/webhooks` | List configured webhooks | `webhooks:read` |
| GET | `/v1/webhooks/{id}` | Retrieve a webhook configuration | `webhooks:read` |
| PATCH | `/v1/webhooks/{id}` | Update a webhook configuration | `webhooks:write` |
| DELETE | `/v1/webhooks/{id}` | Delete a webhook endpoint | `webhooks:write` |
| POST | `/v1/webhooks/{id}/test` | Send a test event | `webhooks:write` |

**Request (POST):** `url` (HTTPS only), `events` (array), `description`, `secret` (optional — auto-generated if not provided, returned once), `api_version` (optional), `metadata`.

## 6.2 Event Types

| Event Type | Trigger |
|------------|---------|
| `referral.created` | New referral workflow instance created |
| `referral.qualified` | Referral passed eligibility checks |
| `referral.converted` | Referee completed conversion action |
| `referral.rejected` | Referral was rejected (fraud, eligibility) |
| `referral.expired` | Attribution window passed without conversion |
| `reward.earned` | Reward created from successful conversion |
| `reward.pending_approval` | Reward awaiting approval |
| `reward.approved` | Reward approved for fulfillment |
| `reward.rejected` | Reward was rejected |
| `reward.fulfilled` | Reward successfully disbursed |
| `reward.clawed_back` | Reward clawed back after fulfillment |
| `campaign.activated` | Campaign went live |
| `campaign.paused` | Campaign paused |
| `campaign.completed` | Campaign finished |
| `payout.completed` | Payout batch fully processed |
| `payout.failed` | Payout batch failed |
| `fraud.signal_raised` | New fraud signal detected |
| `referrer.blocked` | Referrer was blocked |

Wildcards supported: `referral.*`, `reward.*`, `*`.

## 6.3 Payload Structure

```
{
  "id": "whevt_xxx",
  "type": "reward.earned",
  "api_version": "v1",
  "created_at": "2026-02-06T14:30:00.000Z",
  "data": { ... },
  "previous_data": { ... }
}
```

## 6.4 Delivery Guarantees

**At-least-once delivery.** Clients must deduplicate using `id`. Ordering is approximately chronological but not guaranteed.

## 6.5 Retry Behavior

Exponential backoff: 1min → 5min → 30min → 2h → 12h → 24h. 7 total attempts. 50 consecutive failures → endpoint auto-disabled + notification.

## 6.6 Signing & Verification

Header: `X-ReferralAI-Signature: t=1706190600,v1=sha256_hmac_hex`

Signed payload: `{timestamp}.{raw_request_body}`, HMAC-SHA256 with webhook secret. Reject if timestamp > 5 minutes stale.

## 6.7 Webhook Versioning

`api_version` on webhook configuration locks payload schema to a specific API version. Existing webhooks continue receiving old-format payloads when a new API version is released.

---

# 7. Security & Abuse Considerations

## 7.1 Rate Limiting

| Auth Type | Endpoint Class | Rate Limit | Window |
|-----------|---------------|------------|--------|
| API Key (secret) | Event ingestion | 5,000 req/min | Sliding |
| API Key (secret) | Batch events | 100 req/min | Sliding |
| API Key (publishable) | Touch events | 10,000 req/min | Sliding |
| API Key (publishable) | SDK endpoints | 500 req/min | Sliding |
| OAuth2 JWT | Standard CRUD | 1,000 req/min | Sliding |
| OAuth2 JWT | Analytics reads | 200 req/min | Sliding |

Burst tolerance: 2x per-minute rate in short bursts.

## 7.2 Event Poisoning Prevention

Schema validation, event name type-safety, property sanitization (opaque JSON, never evaluated as code), revenue validation (non-negative integers only), timestamp bounds, context integrity (server-side derivation for publishable keys).

## 7.3 Replay Attack Prevention

Optional `X-Request-Timestamp` header (5-minute tolerance). Webhook signature includes timestamp. Referral links contain signed tokens with embedded expiration.

## 7.4 Privilege Separation

| Concern | Enforcement |
|---------|-------------|
| Conversion events cannot originate from browsers | Publishable keys blocked from `type: "conversion"` |
| Revenue figures cannot be submitted from browsers | Publishable keys cannot include `revenue` in events |
| Configuration changes require dashboard auth | All CRUD endpoints require OAuth2 JWT |
| Self-enrollment only for open campaigns | `POST /v1/sdk/enroll` returns `403` for selective campaigns |
| Reward approval requires explicit configuration | `approval_mode` on Variant's Reward Config gates auto-approval |
| Clawbacks require justification | `reason` field required, immutable audit trail |
| Payouts require two-step confirmation | Create + confirm |
| API key management requires dashboard session | Cannot create/revoke keys via API key |
| Magic link portal is read-only | Token-based auth, no write operations |

## 7.5 Data Residency and Retention

All data stored within the EU (AWS `eu-central-1` primary, `eu-west-1` failover). Event data retained 24 months (configurable: 6–36 months). PII subject to GDPR erasure: anonymized in-place. API keys logged with last four characters only.

## 7.6 IP Allowlisting (Optional)

Secret API keys can be restricted to IP ranges (CIDR). Off by default. Publishable keys do not support this.

## 7.7 Audit Trail

All state-mutating API calls produce an immutable audit log entry. Retained for tenant lifetime plus 12 months. Accessible via dashboard only (not public API).

---

> **Document Status:** Living document. All endpoints are working design hypotheses subject to implementation discovery.  
> **Version:** 1.2  
> **Date:** February 2026  
> **Companion Documents:**  
> - Product & Domain Specification v2.0  
> - Referral Revenue OS Product Specification v3.2  
>  
> **Changes from v1.1:**  
> - Added Section 4: SDK & Widget Endpoints — `GET /v1/sdk/widget-config`, `POST /v1/sdk/enroll`, `GET /v1/sdk/resolve-link`, `POST /v1/sdk/attribution`  
> - Added Section 3.15: Magic Link Micro-Portal with token-based auth  
> - Campaign: added `enrollment_model` (open/selective), `budget`, `attribution_window_days`, `default_variant_id`  
> - Variant: added `is_default`, `priority`, `eligibility_rules` fields; added Default Variant concept  
> - Variant resolution documented at enrollment time (not referee click) with fallback chain  
> - Segment: added `random` type with `random_config` (percentage, seed, sticky, mutual_exclusion_group)  
> - Referrer: added `POST /v1/referrers/batch` (up to 1000), added `attributes` field for segment evaluation  
> - Referrer trust tiers aligned with product spec: unknown → new → trusted → ambassador → flagged → blocked  
> - Added Business Rules Guard in event ingestion with campaign-status-specific validation  
> - Added business-level rate limiting per product spec (per-referral-code, per-IP)  
> - Health Score response structure aligned with product spec component weights  
> - Reward types expanded: `revenue_share`, `leaderboard` added  
> - Playbook instantiation now requires `enrollment_model`  
> - Added `422 Unprocessable` to error model for semantic validation  
> - Aligned all sections with both companion product specifications
