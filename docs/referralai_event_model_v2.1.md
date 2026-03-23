# ReferralAI — Formal Event Model Specification

## Version 2.1 — Schema-Level Specification

> **Classification:** Internal — Architecture  
> **Last Updated:** February 2026  
> **Author:** Data Architecture & Event Modeling  
> **Companion Documents:**  
> - Referral Revenue OS Product Specification v3.2 (`referral_platform_product_spec.md`)  
> - Public API Contract v1.2 (`referralai_api_contract_v1_2.md`)  
> **Audience:** Backend engineers, data engineers, AI/ML team, integration architects

---

## Table of Contents

1. [Event Philosophy](#1-event-philosophy)
2. [Canonical Event Envelope](#2-canonical-event-envelope)
3. [Tracked Events — Externally Produced](#3-tracked-events--externally-produced)
4. [Domain Events — Platform Produced](#4-domain-events--platform-produced)
5. [Attribution Context Object](#5-attribution-context-object)
6. [Identity & Actor Modeling](#6-identity--actor-modeling)
7. [Versioning & Evolution](#7-versioning--evolution)

---

# 1. Event Philosophy

## 1.1 The Two Event Worlds

The ReferralAI event model separates events into two fundamentally distinct categories based on origin, trust, and purpose. This separation is not cosmetic — it governs validation rules, trust enforcement, storage strategy, and processing pipelines.

**Tracked Events** are produced outside the platform. They arrive from the client's JS SDK running in a browser, from the client's backend server, or from external integrations (email tracking pixels, billing webhooks). Tracked events are ingested through the Event Ingestion API (`/v1/events`), authenticated by API keys (publishable or secret), and represent raw signals about what happened in the client's ecosystem. They are the platform's only window into the external world.

**Domain Events** are produced inside the platform by its own services. They result from the platform processing tracked events, executing workflow logic, computing attribution, evaluating fraud, or performing any internal state transition. Domain events are never submitted by external callers. They are emitted onto the internal event bus (SNS/SQS) by the service that performed the action.

This separation reflects the domain architecture defined in the Product Specification (Section 3 — Domain Architecture), where the domains are explicitly isolated: Identity & Access, Program & Campaign, Segmentation, Referral Tracking, Rewards & Payouts, Analytics & Attribution, AI & Optimization, Compliance & Privacy, and Integrations & APIs. Tracked events enter through the Referral Tracking / Integrations gate; domain events flow on the bus between all other domains.

```
EXTERNAL WORLD                          PLATFORM BOUNDARY
─────────────                           ─────────────────

JS SDK (browser)  ──┐
                    ├──▶ /v1/events ──▶ Event Ingestion ──▶ SNS/SQS
Client Backend   ──┤     (API keys)     Service              │
                    │                    (validates,          │
Billing Webhook  ──┤                     enriches,           │
                    │                    deduplicates)        │
Email Pixel      ──┘                                         │
                                                             ▼
                        TRACKED EVENTS             DOMAIN EVENTS
                        (touch.recorded,           (referral.created,
                         conversion.recorded,       reward.earned,
                         custom.recorded)            fraud.signal_raised,
                                                    attribution.computed,
                                                    ...)
                                                             │
                                                             ▼
                                              Workflow Runtime, Rewards,
                                              Analytics, AI, Compliance
```

## 1.2 What Qualifies as an Event

An event is an immutable, timestamped record of a discrete occurrence that has already happened. Events are facts. They represent observed state transitions, not intentions, predictions, or queries.

An occurrence qualifies as an event when it meets all of the following:

**Occurred in the past.** The timestamp reflects the moment of occurrence in the originating system, not the moment of ingestion. For tracked events, `occurred_at` is set by the external source. For domain events, `occurred_at` is set by the producing service at the moment of the action.

**Is domain-significant.** The occurrence either advances a referral workflow, produces data needed for attribution or analytics, represents a business-relevant state change, or generates a signal consumed by at least one downstream service.

**Is independently meaningful.** A single event, read in isolation with its full payload, conveys enough information for a consumer to understand what happened without requiring prior events to decode it. Events are self-describing.

**Is idempotent by identity.** Each event carries identifiers (`event_id` from the platform, `external_id` from the source) that allow any consumer to safely receive the same event more than once without producing incorrect side effects.

## 1.3 What Is Explicitly Not an Event

The following are not events and must never be modeled as such:

**Current state.** The current status of a referral, the trust score of a participant, or the pending reward balance are projections derived from events. They are materialized views or read-model aggregates, not events.

**Configuration changes.** Updating a Campaign's name, modifying Segment rules, or adjusting a Reward Configuration are administrative mutations recorded in audit logs. The exception is when a configuration change produces an observable effect on active workflows — such as `campaign.activated` — in which case the *effect* is the event.

**Queries and reads.** Listing referrals, viewing a dashboard, or fetching analytics does not produce events.

**Intentions and commands.** A request to approve a reward is a command. The event is `reward.approved`, which occurs only after validation and execution. Commands may fail; events cannot.

**Forecasts and predictions.** AI propensity scores and fraud probabilities are derived signals. When such a signal triggers an action (a fraud hold, an alert), the *action* is the event.

**Processing artifacts.** Queue entries, retry bookkeeping, deduplication cache lookups, and partial aggregation results are infrastructure concerns.

## 1.4 Why Immutability Matters

The event model is append-only. Once an event is accepted, it is never modified, deleted, or overwritten. This is a load-bearing requirement:

**Attribution integrity.** Attribution decisions are computed from the historical sequence of touch and conversion events. Retroactive alteration would make attribution results unreliable. Clients disputing a reward must be able to audit the exact chain of events that produced the attribution — unchanged from the moment they occurred.

**Audit compliance.** GDPR requires a verifiable record of data-processing activities. Mutable events undermine evidentiary value. GDPR erasure is handled by anonymizing PII within events (replacing values with opaque tokens), not by deleting events.

**AI training stability.** The AI subsystem (propensity scoring, fraud detection, incentive optimization) trains on historical event data. If events could change post-hoc, model reproducibility would be compromised.

**Idempotent reprocessing.** The pipeline supports replay — reprocessing event ranges to rebuild derived state, backfill analytics, or recover from processing errors. Immutability guarantees deterministic results on replay.

**Correction model.** When reality contradicts a recorded event (a chargeback reverses a payment, fraud is discovered), the platform produces a *new* event recording the correction. The original event stands; a `reward.clawed_back` event records the reversal. Both are facts.

---

# 2. Canonical Event Envelope

Every event — tracked or domain — conforms to a single top-level envelope. This is the contract between producers and consumers. Consumers route, filter, and begin processing any event based on envelope fields without parsing the domain-specific payload.

## 2.1 Envelope Fields

### `event_id`

- **Type:** String (ULID, time-ordered)
- **Assigned by:** Platform, at ingestion time (tracked events) or at emission time (domain events).
- **Purpose:** Globally unique, platform-authoritative identifier. Primary key in all storage systems. ULID is chosen for time-ordered sorting, lexicographic sortability, and efficient range queries in ClickHouse and PostgreSQL. Per API Contract Section 1.2, all resource identifiers are opaque ULIDs encoded as 26-character Crockford Base32 strings.
- **Mutability:** Assigned once, never changes.

### `external_id`

- **Type:** String (max 256 characters)
- **Assigned by:** The event source.
- **Purpose:** Source-authoritative deduplication key, scoped to the tenant. If the platform receives a second event with the same `tenant_id` + `external_id` within the 90-day deduplication window, the second event is treated as a duplicate and not reprocessed. For tracked events, the client provides this. For domain events, the producing service generates it deterministically from the triggering event(s). Per API Contract Section 1.4, this is the primary idempotency mechanism for the Event Ingestion API — distinct from the `Idempotency-Key` header used by all other POST endpoints.
- **Required:** Yes, on all events.

### `schema_version`

- **Type:** Integer
- **Purpose:** Identifies the version of the payload schema for this specific `event_type`. Starts at `1`. Incremented on breaking changes to the payload. Consumers dispatch deserialization logic using `event_type` + `schema_version`. See Section 7.

### `event_type`

- **Type:** String (dot-notation, pattern: `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$`, max 128 characters)
- **Purpose:** Fully qualified event type. Primary routing key. Consumers subscribe to types or type prefixes (e.g., `reward.*`).
- **Naming convention:** `{domain}.{action_in_past_tense}`. Always past tense because events record what already happened. `signup_completed`, not `signup`. Per API Contract Section 5.3, tracked event names must match the same pattern.

### `event_class`

- **Type:** Enum: `tracked`, `domain`
- **Purpose:** Declares whether this event was produced externally (tracked) or internally (domain). This field is authoritative and set by the platform — it cannot be overridden by callers. Consumers can use this for routing: analytics consumers may process all events; the workflow runtime only processes tracked events from the ingestion pipeline; downstream services only process domain events from upstream services.

### `occurred_at`

- **Type:** ISO 8601 with millisecond precision, UTC (`2026-02-06T14:30:00.000Z`)
- **Purpose:** The moment the event occurred in the source system. For tracked events from browsers, this is the client-side timestamp (subject to clock skew tolerances). For tracked events from backends, this is the client's server timestamp. For domain events, this is the platform service's processing timestamp.
- **Validation (tracked events):** Must not be in the future beyond a 5-minute tolerance. Must not be older than 7 days for touch events or 30 days for conversion events (per API Contract Section 5.3). Configurable per tenant.
- **Validation (domain events):** Set by the producing service. No age limit.
- **Format:** Per API Contract Section 1.8, all timestamps are ISO 8601 in UTC with millisecond precision. Timezone offsets are rejected.

### `ingested_at`

- **Type:** ISO 8601 with millisecond precision, UTC
- **Assigned by:** Platform.
- **Purpose:** Operational timestamp. For tracked events: the moment the event cleared validation and was accepted. For domain events: the moment the event was emitted to the bus. Used for pipeline monitoring, latency measurement, and replay windowing. Not used for attribution or business logic.

### `source`

- **Type:** Object
- **Purpose:** Identifies where the event originated and the trust context. Critical for trust-differentiated processing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `origin` | Enum | Yes | `js_sdk`, `client_backend`, `webhook_relay`, `platform_service`. Identifies the producing system. |
| `trust_level` | Enum | Yes | `high`, `low`. `high` for secret API keys (`rai_live_`), internal services, and webhook relays. `low` for publishable API keys (`rai_pub_`, browser SDK). Domain events always inherit `high`. Per API Contract Section 2.2. |
| `api_key_prefix` | String | Conditional | Last four characters of the API key that authenticated the request. Present on tracked events. Absent on domain events. Full key is never stored (per API Contract Section 7.5). |
| `sdk_version` | String | No | JS SDK version, if applicable. For debugging and compatibility. |
| `producing_service` | String | Conditional | For domain events: the internal service that produced the event (e.g., `workflow-runtime`, `reward-evaluator`, `fraud-detector`, `attribution-engine`). Absent on tracked events. |
| `integration_id` | String | No | If the tracked event was relayed from a third-party integration (Stripe, Paddle, Chargebee, CRM connector), the configured integration identifier. |

### `tenant`

- **Type:** Object
- **Purpose:** Identifies the Client Account that owns this event. Every event belongs to exactly one tenant. Tenant isolation is absolute. Per API Contract Section 2.4, all queries are implicitly scoped to the tenant — there is no cross-tenant access.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tenant_id` | String (ULID) | Yes | The Client Account identifier. Derived from the authenticating API key on tracked events. Set by the producing service on domain events. |

### `actor`

- **Type:** Object
- **Purpose:** Identifies the entity that caused or is the primary subject of the event.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `actor_type` | Enum | Yes | `participant`, `referee`, `operator`, `system`, `ai_agent`. See Section 6.1. |
| `actor_id` | String | Conditional | Platform identifier. Present when the actor has been identified. Absent for anonymous touch events. |
| `actor_external_id` | String | No | The client's own identifier for this actor. Used for identity stitching. |
| `actor_email_hash` | String | No | SHA-256 hash of the actor's email. Used for cross-event linking before `actor_id` resolution. Raw email is never stored in the event envelope. |
| `anonymous_id` | String | No | Transient identifier for anonymous actors. Derived from session ID, device fingerprint, or cookie token. |

**Terminology note:** The Product Specification (Section 4) uses "Participant" as the primary term for the external actor who refers others. The API Contract (Section 3.5) uses "Referrer" as the resource name. This event model uses `participant` in the `actor_type` enum to align with the product domain language, while acknowledging that the API resource is `/v1/referrers`. Both terms refer to the same entity.

### `object`

- **Type:** Object
- **Purpose:** Identifies the primary domain entity the event pertains to. If the event is about a Referral being converted, the object is the Referral. If about a Reward being approved, the object is the Reward.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `object_type` | Enum | Yes | `referral`, `reward`, `touch`, `campaign`, `program`, `participant`, `segment`, `payout`, `recommendation`, `variant`. |
| `object_id` | String (ULID) | Conditional | Platform identifier. Present when the entity exists at event time. May be absent on creation events (enriched during processing). |

### `attribution_context`

- **Type:** Object (nullable)
- **Purpose:** The referral attribution chain connecting this event to its originating Campaign, Variant, Participant, and referral link. Present on all events within a referral workflow. Absent on events that are not part of a referral chain. Defined in full in Section 5.

### `context`

- **Type:** Object
- **Purpose:** Environmental and technical metadata captured at the moment of the event. For tracked events with `trust_level: low`, certain fields are overridden by server-derived values to prevent client-side spoofing (per API Contract Section 5.6).

| Field | Type | Required | Trust | Description |
|-------|------|----------|-------|-------------|
| `ip_hash` | String | No | Server-derived for `low` trust; client-provided for `high` trust | SHA-256 hash of originating IP. Raw IP never stored. |
| `user_agent` | String | No | Server-derived for `low` trust | Full user agent string. |
| `device_type` | Enum | No | Derived | `desktop`, `mobile`, `tablet`, `unknown`. Parsed from user agent. |
| `browser` | String | No | Derived | Browser name and version. |
| `os` | String | No | Derived | Operating system name and version. |
| `country` | String (ISO 3166-1 alpha-2) | No | Server-derived | Geo-resolved from IP. |
| `region` | String | No | Server-derived | Sub-national region, when available. |
| `page_url` | String | No | Client-provided | Page URL where the event occurred. Query parameters preserved, fragment identifiers stripped. |
| `referrer_url` | String | No | Client-provided | HTTP referrer of the page. |
| `session_id` | String | No | Client-provided | SDK session identifier (stored in `_rr_sess` cookie per Product Specification Section 9). Used for touch grouping, secondary deduplication, and identity stitching. |
| `locale` | String | No | Client-provided | Browser or system locale (e.g., `de-DE`). |

**Note:** The `context` section is primarily meaningful for tracked events. Domain events may carry a minimal `context` or omit it entirely, depending on the producing service.

### `consent`

- **Type:** Object
- **Purpose:** Records the consent status of the data subject at event time. This determines downstream processing permissions. If consent is denied, the event is accepted but processed in restricted mode: no cookies set, no fingerprints captured, no PII linked, attribution best-effort only. Per Product Specification Section 9 (Consent Handling in SDK).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tracking_consent` | Enum | Yes (tracked events), No (domain events) | `granted`, `denied`, `unknown`. Whether the data subject consented to referral tracking. Required on all tracked events per API Contract Section 5.3. Domain events inherit consent from the tracked event that triggered them. |
| `marketing_consent` | Enum | No | `granted`, `denied`, `unknown`. Whether the data subject consented to marketing communications. |
| `consent_source` | Enum | No | `cmp_banner`, `signup_form`, `api`, `widget`, `inherited`. How consent was obtained. Product Specification Section 9 provides CMP integration examples (OneTrust, Cookiebot, Osano). |
| `consent_recorded_at` | ISO 8601 | No | When the consent signal was captured. |

### `properties`

- **Type:** Object (freeform key-value)
- **Purpose:** The domain-specific payload. Schema varies by `event_type` and is defined in Sections 3 and 4. This is the only envelope section where structure differs across event types.
- **Constraints:** Maximum 50 keys. Maximum 10 KB serialized (per API Contract Section 5.3). Keys must match `^[a-z][a-z0-9_]{0,63}$`. Values must be JSON primitives (string, number, boolean, null) or flat arrays of primitives. No nested objects. This keeps events queryable in ClickHouse without complex JSON extraction and ensures flat, analyzable data for the AI subsystem.

### `metadata`

- **Type:** Object (freeform key-value)
- **Purpose:** Client-supplied opaque metadata. Passed through without interpretation. Not indexed, not queried, not used for platform logic. Exists for the client's operational convenience.
- **Constraints:** Maximum 20 keys. Maximum 5 KB serialized.

## 2.2 Envelope Stability Guarantee

The top-level envelope is considered stable. New top-level fields may be added (additive change), but existing fields will not be removed, renamed, or have their types changed within an API version. Consumers must tolerate unknown top-level fields (open-world assumption). Per API Contract Section 1.3, additive changes are the only permitted evolution within a version.

The `properties` section is governed by `schema_version` and evolves per event type, as described in Section 7.

---

# 3. Tracked Events — Externally Produced

## 3.1 Overview

Tracked events originate outside the platform boundary. They arrive through the Event Ingestion API (`/v1/events`, API Contract Section 5) and represent raw observations from the client's ecosystem — user interactions, business transactions, and behavioral signals that the platform cannot observe directly.

The API Contract (Section 5.3) defines three tracked event types:

| `type` Field | Purpose | Accepted From |
|--------------|---------|---------------|
| `touch` | Interactions between a Referee and a Participant's referral artifact (link, widget, email) | JS SDK (publishable key) or client backend (secret key) |
| `conversion` | Business-significant actions by a Referee that satisfy a Campaign's goal | Client backend only (secret key — hard enforcement) |
| `custom` | Behavioral signals for segmentation and AI that do not directly trigger referral workflow transitions | Client backend only (secret key) |

Once a tracked event passes validation, deduplication, trust enforcement, business rules, and enrichment in the Event Ingestion Service, it is emitted onto the internal event bus as one of three validated forms: `touch.recorded`, `conversion.recorded`, or `custom.recorded`. These validated forms are the only tracked events that downstream services consume.

```
Raw Tracked Event               Validated Tracked Event
(from external caller)          (on internal event bus)
──────────────────              ──────────────────────
type: touch         ──▶         event_type: touch.recorded
type: conversion    ──▶         event_type: conversion.recorded
type: custom        ──▶         event_type: custom.recorded
```

## 3.2 Trust Boundaries

Trust enforcement at the ingestion boundary is the platform's primary security control for tracked events. The rules are defined in the API Contract (Section 5.6) and are non-negotiable.

| Source | API Key Type | Permitted `type` Values | Trust Level | Context Handling |
|--------|-------------|------------------------|-------------|------------------|
| JS SDK / Browser | Publishable (`rai_pub_`) | `touch` only | `low` | `ip_hash` and `user_agent` derived server-side from HTTP request — body values ignored. `consent_status` accepted from SDK (SDK reads from CMP). No `revenue`, no conversion events. |
| Client Backend | Secret (`rai_live_`) | `touch`, `conversion`, `custom` | `high` | All fields trusted. Revenue amounts accepted. Full context trusted. |
| Webhook Relay | Secret (via integration config) | `conversion`, `custom` | `high` | Relayed from Stripe, Paddle, Chargebee, or other configured integration (per Product Specification Section 9, Method B). Platform verifies webhook signature before processing. |

A publishable key submitting a `conversion` event receives `403 Forbidden` (per API Contract Section 5.6). This is a hard block — conversion events determine reward payouts and must originate from a trusted backend.

## 3.3 Touch Events

Touch events record interactions between a Referee (known or anonymous) and a Participant's referral artifact. They are the platform's primary input for attribution.

The Product Specification (Section 3 — Referral Tracking: Touch Capture Explained) defines six touch types: Click, Share, Widget View, Page Visit, Email Open, and Email Click. Each is modeled as a distinct tracked event type below.

### `touch.link_clicked`

**Purpose:** A Referee interacted with a Participant's referral link. This is the foundational touch event. It initiates the attribution window, may create a Referral workflow instance, and is the primary input to the Attribution Engine.

**Expected source:** JS SDK (browser) or client backend (server-side redirect tracking).

**Trust level:** Typically `low` (browser). Can be `high` when captured by server-side redirect handler.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_code` | String | Yes | The unique referral code embedded in the link. Resolves to a Participant and Campaign. |
| `link_url` | String | Yes | The full referral link URL that was clicked. |
| `landing_url` | String | No | The destination URL after redirect. |
| `channel` | Enum | No | `organic_link`, `email`, `social_share`, `widget`, `qr_code`, `api`. Defaults to `organic_link`. |
| `utm_source` | String | No | UTM parameter, if present on the link. |
| `utm_medium` | String | No | UTM parameter, if present. |
| `utm_campaign` | String | No | UTM parameter, if present. |
| `utm_content` | String | No | UTM parameter, if present. |
| `is_repeat_visit` | Boolean | No | Whether the Referee has clicked this code before (detected from session/cookie). |

**Validation at ingestion:**
- `referral_code` must resolve to an active or recently-expired campaign (grace period attribution).
- `consent_status` required on envelope.
- If publishable key: `ip_hash` and `user_agent` overridden server-side.
- Secondary deduplication: `referral_code + session_id + 5min_bucket` (per API Contract Section 5.4).

**Downstream consumers (after becoming `touch.recorded`):** Workflow Runtime (route to or create Referral workflow), Attribution Engine (touch recording), Fraud Detection (velocity and IP analysis), Analytics (funnel top), Segmentation (referral activity events).

---

### `touch.link_shared`

**Purpose:** A Participant actively shared a referral link through a trackable channel. Sharing is the Participant's action; clicking is the Referee's action. Sharing events enable participant engagement analytics and propensity modeling.

**Expected source:** JS SDK (widget share button) or client backend (programmatic share tracking).

**Trust level:** `low` (browser widget) or `high` (backend).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_code` | String | Yes | The referral code that was shared. |
| `share_channel` | Enum | Yes | `email`, `twitter`, `linkedin`, `facebook`, `whatsapp`, `copy_link`, `sms`, `custom`. |
| `share_url` | String | No | The full URL shared (may differ from canonical if modified by Participant). |
| `recipient_count` | Integer | No | Number of recipients, if determinable. |

**Downstream consumers (after becoming `touch.recorded`):** Analytics (participant engagement), AI (propensity scoring, channel effectiveness), Participant Lifecycle (activity tracking), Segmentation (referral activity).

---

### `touch.widget_viewed`

**Purpose:** A Participant viewed the referral widget in the client's application. Engagement signal for participant activity tracking and propensity modeling. Per Product Specification Section 3, widget views capture page URL, duration, and variant shown.

**Expected source:** JS SDK (browser).

**Trust level:** `low`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_code` | String | No | Present if the viewer is an enrolled Participant with an active code. |
| `campaign_id` | String | Yes | The Campaign whose widget was rendered. |
| `variant_id` | String | No | The Variant shown, if a Participant is enrolled. |
| `page_url` | String | Yes | The page where the widget was rendered. |
| `view_duration_ms` | Integer | No | Milliseconds the widget was visible. |
| `widget_mode` | Enum | No | `active_referrer`, `enrollment_cta`, `hidden`. Per Product Specification Section 9 and API Contract Section 4.2. |

**Downstream consumers (after becoming `touch.recorded`):** Analytics (participant engagement), AI (propensity scoring), Participant Lifecycle (activity tracking).

---

### `touch.page_viewed`

**Purpose:** A Referee viewed a page on the client's site while a referral session is active. Provides engagement depth signals for multi-touch attribution and AI propensity modeling. Less significant than a link click but still contributes to the touch sequence when a referral code is present in the session.

**Expected source:** JS SDK (browser).

**Trust level:** `low`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_code` | String | Yes | From the active session cookie (`_rr_ref`). |
| `page_url` | String | Yes | The URL viewed. |
| `page_title` | String | No | The HTML page title. |
| `time_on_page_ms` | Integer | No | Milliseconds spent on the previous page (set when navigating away). |

**Downstream consumers (after becoming `touch.recorded`):** Attribution Engine (engagement depth for AI-weighted model), Analytics (funnel depth), Fraud Detection (session pattern analysis).

---

### `touch.email_invitation_opened`

**Purpose:** A Referee opened an email invitation sent by a Participant or by the platform on behalf of the Participant. Mid-funnel engagement signal. Strengthens the attribution chain. Per Product Specification Section 3, email opens are captured via tracking pixel.

**Expected source:** Platform email service (tracking pixel). Arrives as a webhook relay or direct platform service call.

**Trust level:** `high` (platform-generated).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_code` | String | Yes | The referral code associated with the invitation. |
| `invitation_id` | String | Yes | Platform identifier for the specific invitation. |
| `email_template_id` | String | No | The template used. |
| `open_count` | Integer | No | Cumulative open count. Only the first open is attribution-significant. |

**Downstream consumers (after becoming `touch.recorded`):** Attribution Engine (weighted touch), Analytics (email funnel), Participant Lifecycle (engagement tracking).

---

### `touch.email_link_clicked`

**Purpose:** A Referee clicked a link within an email invitation. Stronger engagement signal than an email open. Per Product Specification Section 3, email clicks are captured via redirect through tracking URL with link_id, timestamp, and destination.

**Expected source:** Platform email service (redirect handler).

**Trust level:** `high` (platform-generated).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_code` | String | Yes | The referral code associated with the invitation. |
| `invitation_id` | String | Yes | Platform identifier for the invitation. |
| `link_id` | String | Yes | Identifier for the specific link within the email that was clicked. |
| `destination_url` | String | Yes | The URL the link resolved to. |

**Downstream consumers (after becoming `touch.recorded`):** Attribution Engine (weighted touch — higher weight than email open), Analytics (email funnel conversion), Participant Lifecycle (engagement tracking).

---

## 3.4 Conversion Events

Conversion events record business-significant actions by a Referee that satisfy a Campaign's goal criteria. They trigger workflow state transitions, eligibility evaluation, fraud checking, and reward computation.

**All conversion events must originate from the client's trusted backend (secret API key). This is a hard enforcement at the ingestion boundary (API Contract Section 5.6).**

### `conversion.signup_completed`

**Purpose:** A Referee completed a signup in the client's product. Primary conversion event for the Signup Pulse (Product Specification Section 6). Also the entry event for the Conversion Pulse (trial-to-paid flow).

**Trust level:** `high` (mandatory).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referee_email` | String | Conditional | Required if `referee_external_id` not provided. Used to link conversion to Referral via prior touch events. Per API Contract Section 5.3. |
| `referee_external_id` | String | Conditional | Client's identifier for Referee. Required if `referee_email` not provided. |
| `referral_code` | String | No | If known, enables direct attribution without probabilistic matching. |
| `signup_method` | Enum | No | `email`, `google_oauth`, `saml_sso`, `github`, `custom`. |
| `plan_type` | String | No | Plan or tier signed up for (e.g., `free`, `trial`, `starter`). |
| `account_type` | Enum | No | `individual`, `team`, `enterprise`. |

**Downstream consumers (after becoming `conversion.recorded`):** Workflow Runtime (referral state transition to `qualified` or `converted`), Eligibility Engine, Fraud Detection, Reward Evaluator, Analytics (conversion funnel), Segmentation (purchasing events).

---

### `conversion.payment_completed`

**Purpose:** A Referee completed a payment, transitioning from free or trial to paying. Primary conversion event for the Conversion Pulse. Secondary enrichment event for the Signup Pulse when rewards depend on payment.

**Trust level:** `high` (mandatory).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referee_email` | String | Conditional | Required if `referee_external_id` not provided. |
| `referee_external_id` | String | Conditional | Required if `referee_email` not provided. |
| `referral_code` | String | No | For direct attribution. |
| `revenue` | Object | Yes | Revenue details (sub-schema below). |
| `payment_provider` | String | No | `stripe`, `paddle`, `chargebee`, `paypal`, `wire`, `custom`. Expanded to align with Product Specification Section 9, Method B supported providers. |
| `payment_external_id` | String | No | Payment identifier in client's billing system. |
| `plan_id` | String | No | The plan the payment is for. |
| `plan_name` | String | No | Human-readable plan name. |
| `billing_interval` | Enum | No | `monthly`, `quarterly`, `annual`, `one_time`, `custom`. |
| `is_first_payment` | Boolean | No | Whether this is the Referee's first-ever payment. |
| `trial_converted` | Boolean | No | Whether this payment represents a trial-to-paid conversion. |

**Revenue sub-schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | Integer | Yes | Payment amount in minor currency units (cents). Non-negative. Per API Contract Section 1.9, all monetary values are integers in minor units. |
| `currency` | String (ISO 4217) | Yes | Three-letter currency code. Always accompanies a monetary value. |
| `type` | Enum | Yes | `one_time`, `recurring`. |
| `mrr` | Integer | No | Monthly recurring revenue in minor units. Required for recurring payments. Annual payments: `mrr` = annual amount / 12, rounded down. |
| `arr` | Integer | No | Annual recurring revenue in minor units. |
| `ltv_estimate` | Integer | No | Client-provided lifetime value estimate in minor units. Used by AI for reward optimization. |

**Downstream consumers (after becoming `conversion.recorded`):** Workflow Runtime (state transition), Reward Evaluator (reward calculation based on revenue), Attribution Engine (revenue attribution), Analytics (revenue KPIs), AI (LTV modeling, incentive optimization), Segmentation (purchasing events).

---

### `conversion.subscription_renewed`

**Purpose:** An existing subscriber renewed their subscription. Primary conversion event for the Renewal Pulse (Product Specification Section 6). Can trigger rewards when referred customer retention is a rewarded outcome (e.g., Recurring reward structure per Product Specification Section 8).

**Trust level:** `high` (mandatory).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referee_email` | String | Conditional | Required if `referee_external_id` not provided. |
| `referee_external_id` | String | Conditional | Required if `referee_email` not provided. |
| `referral_code` | String | No | If known. |
| `revenue` | Object | Yes | Same revenue sub-schema as `conversion.payment_completed`. |
| `renewal_number` | Integer | No | Times renewed (1 for first renewal). |
| `previous_plan_id` | String | No | Plan before renewal, if changed. |
| `new_plan_id` | String | No | Plan after renewal. |
| `retention_days` | Integer | No | Days the subscriber has been continuously active. |

**Downstream consumers (after becoming `conversion.recorded`):** Workflow Runtime, Reward Evaluator (renewal-linked rewards, revenue share duration per API Contract Section 3.3), Attribution Engine (recurring revenue attribution), Analytics, AI (churn propensity recalculation), Segmentation.

---

### `conversion.feedback_submitted`

**Purpose:** A user submitted a review, rating, NPS response, or testimonial. Conversion event for the Feedback Pulse (Product Specification Section 6). Non-monetary or low-value rewards expected.

**Trust level:** `high`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referee_email` | String | Conditional | Required if `referee_external_id` not provided. |
| `referee_external_id` | String | Conditional | Required if `referee_email` not provided. |
| `feedback_type` | Enum | Yes | `review`, `rating`, `nps`, `testimonial`, `survey`, `custom`. |
| `rating_value` | Number | No | Numeric rating (e.g., 4.5 out of 5). |
| `rating_scale_max` | Number | No | Maximum rating scale value. Required if `rating_value` present. |
| `nps_score` | Integer | No | NPS score (0–10). Present only for `feedback_type: nps`. |
| `feedback_platform` | String | No | Where submitted (e.g., `g2`, `capterra`, `trustpilot`, `in_app`). |
| `has_text_content` | Boolean | No | Whether feedback includes written text. Text itself not stored in event for privacy. |
| `is_verified_purchase` | Boolean | No | Whether reviewer is a verified customer. |

**Downstream consumers (after becoming `conversion.recorded`):** Workflow Runtime, Reward Evaluator, Analytics (engagement KPIs), AI (quality signals, spam detection), Segmentation (support events).

---

## 3.5 Custom Events

Custom events carry behavioral signals that do not directly trigger referral workflow transitions but feed segmentation rules, propensity models, and analytics. They are the mechanism by which the client communicates product usage, lifecycle changes, and other relevant activity to the platform.

The Product Specification (Section 5 — Segmentation & Eligibility) identifies the following behavioral event categories as inputs to the segmentation engine:

| Category | Example `event_name` Values | Used For |
|----------|----------------------------|----------|
| Product usage | `session.started`, `feature.used`, `page.viewed` | Engagement scoring, propensity |
| Purchasing (non-conversion) | `plan.upgraded`, `plan.downgraded`, `addon.activated` | Revenue segmentation, LTV |
| Churn signals | `subscription.cancelled`, `user.deactivated` | Churn propensity |
| Support | `ticket.created`, `nps.submitted` | Satisfaction scoring |
| Education | `education.module_completed`, `feature.first_used` | Product Education Pulse triggers |
| Migration | `migration.completed` | Switch-Up Pulse triggers |
| Newsletter | `newsletter.subscribed` | Newsletter Pulse triggers |
| Reactivation | `user.reactivated`, `subscription.restarted` | Reactivation Pulse triggers |

**Trust level:** `high` (secret key only, per API Contract Section 5.6).

**Common fields across all custom events:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_name` | String | Yes | Dot-notation name (e.g., `session.started`, `feature.used`). Free-form within naming pattern rules per API Contract Section 5.3. |
| `actor_email` | String | No | Email of the user who performed the action. Used for identity linking. |
| `actor_external_id` | String | No | Client's identifier for the actor. |
| `properties` | Object | No | Freeform key-value pairs. Max 50 keys, 10 KB. |

**Downstream consumers (after becoming `custom.recorded`):** Segmentation (rule evaluation, membership updates), Analytics (ClickHouse storage), AI (feature engineering for propensity models). Custom events do **not** flow to the Workflow Runtime — they cannot directly create or advance Referral workflows.

**Exception — Pulse-specific custom events:** Certain custom events listed above (e.g., `user.reactivated`, `migration.completed`, `newsletter.subscribed`) are significant to specific Pulses (Product Specification Section 6). When these events match a running Campaign's Pulse trigger configuration, the Segmentation service produces a `conversion.recorded` domain event internally, which then flows to the Workflow Runtime. The custom event itself does not reach the workflow — the translation is explicit.

---

## 3.6 Tracked Event Processing Pipeline

For reference, the complete tracked event processing pipeline as defined in the Product Specification (Section 9 — Attribution Flow) and API Contract (Section 5.9):

```
STEP 1: CAPTURE (external system)
  SDK / backend constructs event payload.

STEP 2: TRANSMIT (HTTP)
  POST /v1/events with API key.

STEP 3: VALIDATE (Event Ingestion Service — sync)
  • Schema validation (event_name pattern, field types)
  • Trust boundary: publishable key → touch only, no conversion (API Contract Section 5.6)
  • Context derivation: IP hash + UA from HTTP request (ignores body for low trust)
  • Timestamp bounds: not future (5min), not older than 7d/30d (API Contract Section 5.3)
  • Idempotency: external_id in Redis (90-day window, per API Contract Section 1.4)
    + secondary dedup: referral_code + session_id + 5min_bucket (touch events, per API Contract Section 5.4)

STEP 4: BUSINESS GUARD (Event Ingestion Service — sync)
  • Resolve referral_code → campaign_id, participant_id
  • Check campaign status: archived (410), completed (410), paused (conditional), scheduled (422)
  • Check link expiry (410), link revocation (403)
  • Rate limit check: per API key, per referral code, per IP, per tenant
  • Per API Contract Section 5.7 and Section 5.8

STEP 5: ENRICH (Event Ingestion Service — sync)
  • Attach Attribution Context (campaign_id, program_id, participant_id)
  • Set attribution_window_opens_at / closes_at
  • Geo resolution from IP
  • Assign ingested_at, event_id

STEP 6: EMIT (Event Ingestion Service → SNS/SQS)
  • Publish validated event as touch.recorded / conversion.recorded / custom.recorded
  • Return 202 Accepted to caller.

STEP 7: PROCESS (downstream services — async)
  • Workflow Runtime, Segmentation, Analytics, AI, Fraud Detection
    consume from bus and process independently.
```

Response is always `202 Accepted` on success. Downstream processing is eventually consistent. Clients poll `processing_status` via GET `/v1/events/{id}` or subscribe to outbound webhooks for domain events (API Contract Section 6).

---

## 3.7 SDK Event Name → Formal Event Type Mapping

The JS SDK and client backends submit events using short names in the `event_name` field of the API payload. The Event Ingestion Service maps these to the formal `event_type` values used on the internal event bus and throughout the domain model. This table provides the authoritative mapping.

### SDK Touch Events (Publishable or Secret Key)

Per Product Specification Section 9 (GRANTED consent mode), the SDK emits three touch event names:

| SDK `event_name` | Formal `event_type` (on bus) | Source | Description |
|-------------------|------------------------------|--------|-------------|
| `link.clicked` | `touch.link_clicked` | JS SDK (auto-captured on referral link redirect) | Referee clicked a referral link. SDK captures from URL parameter `?ref=` and fires automatically. |
| `link.shared` | `touch.link_shared` | JS SDK (widget share button interaction) | Participant shared their referral link via the widget's share buttons. |
| `widget.viewed` | `touch.widget_viewed` | JS SDK (auto-captured on widget render) | Participant viewed the referral widget. Fired when the widget DOM element becomes visible. |

These three events are the only touch events the SDK emits directly. `touch.page_viewed`, `touch.email_invitation_opened`, and `touch.email_link_clicked` are not SDK-originated — they arrive from the client backend or platform email service respectively.

### Backend Touch Events (Secret Key Only)

| Backend `event_name` | Formal `event_type` (on bus) | Source | Description |
|-----------------------|------------------------------|--------|-------------|
| `link.clicked` | `touch.link_clicked` | Client backend (server-side redirect tracking) | Same event as SDK, but captured by server-side redirect handler instead of browser. |
| `link.shared` | `touch.link_shared` | Client backend (programmatic share tracking) | Same event as SDK, but submitted from backend for non-browser share channels. |
| `page.viewed` | `touch.page_viewed` | Client backend | Page view with active referral session. |
| `email.opened` | `touch.email_invitation_opened` | Platform email service (tracking pixel) | Email invitation opened by Referee. |
| `email.clicked` | `touch.email_link_clicked` | Platform email service (redirect handler) | Referee clicked a link within email invitation. |

### Backend Conversion Events (Secret Key Only)

| Backend `event_name` | Formal `event_type` (on bus) | Source | Description |
|-----------------------|------------------------------|--------|-------------|
| `user.signup_completed` | `conversion.signup_completed` | Client backend | Referee completed signup. |
| `payment.completed` | `conversion.payment_completed` | Client backend or billing webhook relay | Referee completed payment. |
| `subscription.renewed` | `conversion.subscription_renewed` | Client backend or billing webhook relay | Subscriber renewed. |
| `feedback.submitted` | `conversion.feedback_submitted` | Client backend | User submitted feedback/review/NPS. |

### Backend Custom Events (Secret Key Only)

Custom events retain their client-defined `event_name` as-is. The formal `event_type` is always `custom.recorded`. The original `event_name` is preserved in `properties.event_name` for downstream consumers (segmentation rules, analytics).

### Mapping Rules

1. The `event_name` field in the API payload is the client-facing name. The `event_type` field in the canonical envelope is the platform-internal name.
2. For touch and conversion events, the mapping is deterministic and defined above. The Event Ingestion Service performs the translation during validation (Step 3 of the pipeline, Section 3.6).
3. For custom events, no translation occurs — the `event_type` is always `custom.recorded` regardless of `event_name`.
4. If an unrecognized `event_name` is submitted for `type: touch` or `type: conversion`, the event is rejected with `422 Unprocessable Entity`.
5. The SDK does not set `event_name` directly — it uses internal method calls (`trackClick()`, `trackShare()`, `trackWidgetView()`) that produce the correct names automatically.

---

# 4. Domain Events — Platform Produced

## 4.1 Overview

Domain events are produced by the platform's internal services as they process tracked events, execute workflows, compute derived state, or respond to operator actions. They are never submitted by external callers. They flow on the internal event bus (SNS/SQS) and are consumed by other platform services.

Domain events serve several purposes: they decouple services (the Workflow Runtime does not call the Reward Evaluator directly — it emits `referral.converted` and the Reward service reacts), they provide a complete audit trail of platform decisions, they feed the analytics pipeline with derived data points, and they are the payload for outbound webhooks (API Contract Section 6).

Each domain event is defined below with its producing service, consuming services, and `properties` schema. The producing and consuming services map directly to the domain architecture in the Product Specification (Section 3).

## 4.2 Event Ingestion Events

These are the validated, enriched forms of tracked events after they pass through the Event Ingestion Service. They are technically domain events (produced by the platform), but they carry the full content of the original tracked event. They are the bridge between the external world and internal processing.

**Producing service:** Event Ingestion Service (Referral Tracking domain).

| Event Type | Triggered By | Description |
|------------|-------------|-------------|
| `touch.recorded` | Validated touch event from SDK or backend | A touch event has been accepted, enriched with Attribution Context, and is ready for downstream processing. Carries the full payload from the original tracked event plus enrichment fields. |
| `conversion.recorded` | Validated conversion event from backend | A conversion event has been accepted and is ready for referral matching, eligibility evaluation, and reward computation. |
| `custom.recorded` | Validated custom event from backend | A custom behavioral event has been accepted and is ready for segmentation rule evaluation and analytics storage. |

**Consumers:** Workflow Runtime (`touch.recorded`, `conversion.recorded`), Segmentation (`touch.recorded`, `conversion.recorded`, `custom.recorded`), Analytics (all three), AI & Fraud Detection (`touch.recorded`, `conversion.recorded`).

These events are documented here for completeness. Their `properties` schemas are identical to the corresponding tracked event schemas defined in Section 3, plus the enrichment fields added by the ingestion pipeline (resolved Attribution Context fields, server-derived context values, `processing_status`).

## 4.3 Referral Workflow Lifecycle Events

These events record state transitions in the Referral workflow, as orchestrated by the Temporal-based Workflow Runtime. They correspond to the Referral state machine defined in the Product Specification (Section 2 — Lifecycle States) and the API Contract (Section 3.6).

**Producing service:** Referral Workflow Runtime (Temporal).

**Referral state machine:**

The Product Specification (Section 2) defines: `Pending → Qualified → Converted → Rewarded | Expired | Rejected`. The API Contract (Section 3.6) expands this with implementation states: `created → qualified → converted → rewarded | rejected | clawed_back | expired`. This event model follows the API Contract's implementation states, which are a superset.

```
CREATED ──▶ QUALIFIED ──▶ CONVERTED ──▶ REWARDED
                │                           │
           not eligible                  clawback
                │                           │
                ▼                           ▼
            REJECTED                   CLAWED_BACK
                ▲
           fraud confirmed
                │
                └──────────────────── (from CONVERTED)

CREATED ──▶ EXPIRED  (attribution window passed without conversion)
```

---

### `referral.created`

**Purpose:** A new Referral workflow instance has been created in Temporal. This occurs when a first touch for a new Participant→Referee→Campaign combination is processed, or when a Referral is created explicitly via server-side API (API Contract Section 3.6).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_id` | String (ULID) | Yes | The newly created Referral identifier. |
| `participant_id` | String | Yes | The Participant who owns this referral. |
| `campaign_id` | String (ULID) | Yes | The Campaign this referral belongs to. |
| `variant_id` | String (ULID) | No | Resolved variant. Per Product Specification Section 5, variant resolution happens at participant enrollment (link generation time), so this should be populated from the link's pre-resolved variant. May be absent if the referral was created via explicit API without variant context. |
| `referee_email_hash` | String | No | SHA-256 of Referee email, if known at creation time. |
| `referee_external_id` | String | No | Client's Referee identifier, if known. |
| `referral_code` | String | Yes | The referral code that initiated this referral. |
| `first_touch_at` | ISO 8601 | Yes | Timestamp of the initial touch that triggered creation. |
| `creation_source` | Enum | Yes | `touch_event`, `api_explicit`, `webhook_relay`. How the referral was created. |

**Consumers:** Analytics (funnel tracking), Segmentation (referral activity), Webhook Delivery (outbound `referral.created`, per API Contract Section 6.2).

---

### `referral.qualified`

**Purpose:** The Referral passed eligibility evaluation. All checks at the relevant checkpoint returned positive verdicts. Per Product Specification Section 5, eligibility is evaluated at five checkpoints: Entry, Referral, Conversion, Reward, and Payout.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_id` | String (ULID) | Yes | The Referral that passed. |
| `eligibility_result` | Enum | Yes | `eligible`. |
| `checkpoint` | Enum | Yes | `campaign_entry`, `referral_creation`, `conversion_validation`, `reward_approval`, `payout`. The eligibility checkpoint that was evaluated. |
| `rules_evaluated` | Array of objects | Yes | Each object: `{ "rule": "segment_match", "passed": true, "detail": "..." }`. Full evaluation trace for audit. |
| `evaluated_at` | ISO 8601 | Yes | When eligibility was computed. |

**Consumers:** Analytics, Webhook Delivery (outbound `referral.qualified`).

---

### `referral.converted`

**Purpose:** A conversion event was matched and validated against this Referral. The Referee has completed the Campaign's goal. This event triggers reward evaluation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_id` | String (ULID) | Yes | The Referral that converted. |
| `conversion_event_id` | String (ULID) | Yes | The `event_id` of the triggering `conversion.recorded` event. |
| `conversion_type` | String | Yes | The `event_name` of the conversion (e.g., `user.signup_completed`, `payment.completed`). |
| `revenue` | Object | No | Revenue details if the conversion carried revenue. Same sub-schema as `conversion.payment_completed`. |
| `converted_at` | ISO 8601 | Yes | Timestamp of conversion. |
| `attribution_model_used` | Enum | No | `first_touch`, `last_touch`, `linear`, `time_decay`, `position_based`, `ai_weighted`. The model applied. Per Product Specification Section 10, six models are defined. |

**Consumers:** Rewards & Payouts (triggers `reward.earned`), Fraud Detection (conversion-time fraud checks), Analytics (conversion funnel), AI (conversion signals), Segmentation (referral activity), Webhook Delivery (outbound `referral.converted`).

---

### `referral.rejected`

**Purpose:** The Referral was rejected. Possible reasons: failed eligibility, confirmed fraud, manual operator rejection.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_id` | String (ULID) | Yes | The rejected Referral. |
| `rejection_reason` | String | Yes | Human-readable reason. |
| `rejection_source` | Enum | Yes | `eligibility_engine`, `fraud_detection`, `operator_manual`. |
| `rejected_by_id` | String | No | Operator user ID, if `rejection_source` is `operator_manual`. |

**Consumers:** Analytics, Webhook Delivery (outbound `referral.rejected`), AI (feedback loop for fraud models).

---

### `referral.expired`

**Purpose:** The attribution window passed without a matching conversion. The Referral is closed. Per Product Specification Section 10, default windows are: Click-to-Signup 30 days, Click-to-Conversion 90 days, Signup-to-Conversion 60 days (configurable per campaign).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_id` | String (ULID) | Yes | The expired Referral. |
| `window_days` | Integer | Yes | The attribution window duration that was in effect. |
| `first_touch_at` | ISO 8601 | Yes | When the attribution window opened. |
| `last_touch_at` | ISO 8601 | No | The most recent touch before expiry. |
| `touch_count` | Integer | Yes | Total touches recorded before expiry. |

**Consumers:** Analytics, Webhook Delivery (outbound `referral.expired`), AI (conversion propensity model — negative examples).

---

## 4.4 Reward Lifecycle Events

These events record state transitions in the Reward lifecycle. Rewards are runtime instances created when a Referral's conversion triggers reward evaluation per the Variant's Reward Configuration (API Contract Section 3.3).

**Producing service:** Rewards & Payouts.

**Reward state machine:**

The Product Specification (Section 8) defines: `Pending → Approved → Processing → Paid | Rejected | Reversed`. The API Contract (Section 3.8) expands this with implementation states: `earned → pending_approval → approved → fulfillment_initiated → fulfilled | rejected | clawed_back`. This event model follows the API Contract's implementation states.

```
EARNED ──▶ PENDING_APPROVAL ──▶ APPROVED ──▶ FULFILLMENT_INITIATED ──▶ FULFILLED
                             ──▶ REJECTED                             ──▶ CLAWED_BACK
```

---

### `reward.earned`

**Purpose:** A Reward instance has been created based on the Variant's Reward Configuration. The conversion has been validated and the reward amount computed.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reward_id` | String (ULID) | Yes | The newly created Reward. |
| `referral_id` | String (ULID) | Yes | The Referral that triggered this reward. |
| `recipient_type` | Enum | Yes | `participant`, `referee`. Per Product Specification Section 8 (Two-Sided Rewards). |
| `recipient_id` | String | Yes | Platform ID of the recipient. |
| `reward_type` | Enum | Yes | `flat_cash`, `percentage`, `discount_percentage`, `discount_fixed`, `credit`, `non_monetary`, `revenue_share`, `milestone`, `leaderboard`. Per API Contract Section 3.8. |
| `amount` | Integer | Yes | Calculated reward value in minor currency units. Zero for non-monetary rewards. |
| `currency` | String (ISO 4217) | Conditional | Required when `amount` > 0. |
| `approval_mode` | Enum | Yes | `auto`, `manual`, `auto_below_threshold`, `ai_assisted`. Inherited from Variant's Reward Configuration (API Contract Section 3.3). |
| `auto_approval_eligible` | Boolean | Yes | Whether this reward qualifies for automatic approval based on threshold and fraud score. |
| `triggering_conversion_event_id` | String (ULID) | Yes | The `event_id` of the conversion that triggered this reward. |

**Consumers:** Approval Engine (routes to auto-approve, AI assessment, or manual queue), Analytics (reward funnel), Dashboard (operator notification), Webhook Delivery (outbound `reward.earned`, per API Contract Section 6.2).

---

### `reward.pending_approval`

**Purpose:** The Reward has entered the manual or AI-assisted approval queue. Distinct from `reward.earned` because not all earned rewards require explicit approval — auto-approved rewards skip this state.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reward_id` | String (ULID) | Yes | The Reward awaiting approval. |
| `referral_id` | String (ULID) | Yes | Associated Referral. |
| `approval_mode` | Enum | Yes | `manual`, `ai_assisted`. |
| `cooling_period_ends_at` | ISO 8601 | No | If a cooling period is configured (per API Contract Section 3.3, `cooling_period_days`), when the reward becomes eligible for approval. |
| `fraud_score_at_submission` | Number (0–1) | No | Fraud score of the associated Participant when entering the queue. Per Product Specification Section 7, fraud score range is 0.0–1.0. |

**Consumers:** Dashboard (queue display), Webhook Delivery (outbound `reward.pending_approval`).

---

### `reward.approved`

**Purpose:** The Reward has been approved for fulfillment. Approval may have occurred automatically (below threshold, no fraud signals), via AI assessment, or via manual operator action.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reward_id` | String (ULID) | Yes | The approved Reward. |
| `referral_id` | String (ULID) | Yes | Associated Referral. |
| `approved_by_type` | Enum | Yes | `system_auto`, `ai_assisted`, `operator`. |
| `approved_by_id` | String | No | Operator user ID, if `approved_by_type` is `operator`. |
| `approval_reason` | String | No | Human-readable or AI-generated explanation. Per Product Specification Section 11, AI outputs include reasoning. |
| `fraud_score_at_approval` | Number (0–1) | No | Fraud score at approval time. Recorded for audit and AI training. |
| `amount` | Integer | Yes | Approved amount (may differ from `reward.earned` if adjusted during review). |
| `currency` | String (ISO 4217) | Conditional | Required when `amount` > 0. |

**Consumers:** Fulfillment Engine (triggers payout), Analytics (approval metrics), AI (feedback loop for approval models), Webhook Delivery (outbound `reward.approved`).

---

### `reward.rejected`

**Purpose:** The Reward was rejected during approval. The Participant is not paid.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reward_id` | String (ULID) | Yes | The rejected Reward. |
| `referral_id` | String (ULID) | Yes | Associated Referral. |
| `rejected_by_type` | Enum | Yes | `system_auto`, `ai_assisted`, `operator`. |
| `rejected_by_id` | String | No | Operator user ID, if manual. |
| `rejection_reason` | String | Yes | Logged in immutable audit trail. |

**Consumers:** Analytics, AI (feedback loop), Webhook Delivery (outbound `reward.rejected`).

---

### `reward.fulfilled`

**Purpose:** The Reward payout was successfully disbursed to the recipient.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reward_id` | String (ULID) | Yes | The fulfilled Reward. |
| `referral_id` | String (ULID) | Yes | Associated Referral. |
| `fulfillment_method` | Enum | Yes | `paypal`, `wise`, `sepa`, `gift_card`, `credit`, `discount_code`, `manual`. Per Product Specification Section 8 (Payout Methods). |
| `external_transfer_id` | String | No | Transfer identifier from the fulfillment provider. |
| `fulfilled_at` | ISO 8601 | Yes | When disbursement completed. |
| `amount` | Integer | Yes | Fulfilled amount in minor units. |
| `currency` | String (ISO 4217) | Conditional | Required when `amount` > 0. |

**Consumers:** Analytics, Participant Lifecycle (reward communication), Webhook Delivery (outbound `reward.fulfilled`).

---

### `reward.clawed_back`

**Purpose:** A previously fulfilled Reward was reversed. Occurs when a conversion is invalidated post-fulfillment — chargeback, refund within clawback window (per API Contract Section 3.3, `clawback_window_days`), or confirmed fraud after payout.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reward_id` | String (ULID) | Yes | The clawed-back Reward. |
| `referral_id` | String (ULID) | Yes | Associated Referral. |
| `clawback_reason` | String | Yes | Required. Logged in immutable audit trail. Per API Contract Section 3.8, `reason` is mandatory on clawback. |
| `clawback_amount` | Integer | Yes | Amount clawed back in minor units. May be less than fulfilled amount for partial clawback (per API Contract Section 3.8, `amount` optional for partial). |
| `currency` | String (ISO 4217) | Yes | Currency of the clawback. |
| `initiated_by_type` | Enum | Yes | `system_auto`, `operator`. |
| `initiated_by_id` | String | No | Operator user ID, if manual. |

**Consumers:** Analytics, Participant Lifecycle (balance adjustment), Payout service (negative balance), Webhook Delivery (outbound `reward.clawed_back`).

---

## 4.5 Fraud & Trust Events

Fraud events are produced by the AI & Optimization domain (specifically the fraud detection subsystem). They are signals, not verdicts — they trigger review flows and inform reward approval. Per Product Specification Section 7, fraud detection and the trust model are related but distinct systems: fraud detection is per-event/per-referral (real-time, outputs risk score 0.0–1.0), while the trust model is per-participant (cumulative, outputs trust score 0–100).

**Producing service:** AI & Optimization (Fraud Detection).

### `fraud.signal_raised`

**Purpose:** The fraud detection subsystem identified a suspicious pattern. Triggers review workflow and may auto-hold pending rewards.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `signal_type` | Enum | Yes | `self_referral`, `velocity_abuse`, `disposable_email`, `vpn_proxy`, `device_fingerprint_match`, `payment_reversal`, `geographic_mismatch`, `bot_pattern`, `collusion_pattern`, `reward_harvesting`. Aligned with Product Specification Section 7 (Fraud Signals). |
| `severity` | Enum | Yes | `low`, `medium`, `high`, `critical`. Aligned with Product Specification Section 7 (Fraud Signals severity column). |
| `referral_id` | String (ULID) | No | The Referral under suspicion, if applicable. |
| `participant_id` | String | No | The Participant under suspicion, if applicable. |
| `detection_layer` | Enum | Yes | `rule_based`, `ml_based`, `aggregate_analysis`. |
| `evidence` | Object | Yes | Flat key-value evidence. Examples: `{ "ip_count": 1, "device_count": 15 }`, `{ "referrals_last_hour": 47 }`. |
| `fraud_checkpoint` | Enum | No | `referral_creation`, `qualification`, `reward_approval`, `payout`. Per Product Specification Section 7 (Fraud Checkpoints). |
| `auto_action_taken` | Enum | No | `reward_held`, `participant_flagged`, `auto_blocked`, `none`. Automated response, if any. Per Product Specification Section 7, auto-block thresholds vary by checkpoint (0.6–0.8). |

**Consumers:** Workflow Runtime (hold pending rewards), Rewards & Payouts (block fulfillment), Dashboard (alert), Webhook Delivery (outbound `fraud.signal_raised`, per API Contract Section 6.2).

---

## 4.6 Participant Enrollment & Lifecycle Events

Produced when participants are enrolled, change state, or undergo trust tier transitions. Per Product Specification Section 7, the participant lifecycle is: Candidate → Active → Dormant → Reactivated | Flagged → Suspended → Banned.

**Producing service:** Identity & Access / Program & Campaign Management.

| Event Type | Purpose | Key Properties |
|------------|---------|----------------|
| `participant.enrolled` | Participant registered and enrolled in a campaign. Triggers variant resolution and link generation. | `participant_id`, `campaign_id`, `variant_id`, `enrollment_method` (`api_single`, `api_bulk`, `csv_import`, `crm_connector`, `auto_rule`, `sdk_widget`), `referral_code` (generated link code) |
| `participant.state_changed` | Participant transitioned between lifecycle states | `participant_id`, `previous_state`, `new_state` (enum: `candidate`, `active`, `dormant`, `reactivated`, `flagged`, `suspended`, `banned`), `reason`, `changed_by` |
| `participant.trust_tier_changed` | Trust tier updated based on cumulative behavior | `participant_id`, `previous_tier`, `new_tier` (enum per API Contract Section 3.5: `unknown`, `new`, `trusted`, `ambassador`), `trust_score`, `contributing_factors` |

**Trust tier mapping note:** The Product Specification (Section 7) defines four trust levels: New (0–25), Established (26–50), Trusted (51–75), Advocate (76–100). The API Contract (Section 3.5) uses a different naming convention: unknown (0), new (1–25), trusted (26–60), ambassador (61–100). This event model follows the API Contract's naming and ranges as the implementation-authoritative source.

**Consumers:** Workflow Runtime (`participant.enrolled` — initiates variant resolution), Analytics, Segmentation (`participant.trust_tier_changed` — trust-based eligibility rules), Webhook Delivery.

---

## 4.7 Link Lifecycle Events

Referral links are the primary distribution artifact for the referral program. Each link encodes a `referral_code` bound to a specific Participant, Campaign, and Variant. Links have their own lifecycle: they are generated (at enrollment or via API), may expire (per campaign configuration), and can be revoked (by operator action or system automation when a participant is blocked).

Per API Contract Section 3.5, link generation happens via `POST /v1/referrers/{id}/links`, which resolves the participant's variant assignment, generates the referral code, and returns the link URL with `expires_at`. The Business Rules Guard (API Contract Section 5.7) enforces link validity at ingestion time — expired links return `410 Gone`, revoked links return `403 Forbidden`.

**Producing service:** Referral Workflow Service (Referral Tracking domain).

---

### `link.generated`

**Purpose:** A new referral link was created for a Participant in a Campaign. This typically occurs as part of participant enrollment (Section 4.6) or when an operator generates an additional link via API. The link binds the participant to a resolved variant and produces the referral code that will appear in all subsequent touch events.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `link_id` | String (ULID) | Yes | The unique link identifier. |
| `referral_code` | String | Yes | The generated referral code (e.g., `abc123`). Unique within tenant. |
| `participant_id` | String | Yes | The Participant this link belongs to. |
| `campaign_id` | String (ULID) | Yes | The Campaign the link is associated with. |
| `variant_id` | String (ULID) | Yes | The Variant resolved at link generation time (per Product Specification Section 5). |
| `link_url` | String | Yes | The full referral link URL (e.g., `https://ref.client.com/r/abc123`). |
| `channel` | Enum | No | `link`, `email`, `widget`, `api`. The intended distribution channel, per API Contract Section 3.5. |
| `custom_slug` | String | No | Vanity slug if the client requested one (per API Contract Section 3.5). |
| `expires_at` | ISO 8601 | No | When the link expires. Null if the link does not expire. |
| `generation_source` | Enum | Yes | `enrollment`, `api_explicit`, `sdk_widget`, `bulk_generation`. How the link was created. |

**Consumers:** Analytics (link inventory tracking), Dashboard (link management), Webhook Delivery.

---

### `link.expired`

**Purpose:** A referral link passed its `expires_at` timestamp and is no longer valid for new touches. Touch events referencing an expired link receive `410 Gone` from the Business Rules Guard. Existing Referral workflows created from prior touches on this link are not affected — only new clicks are blocked.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `link_id` | String (ULID) | Yes | The expired link. |
| `referral_code` | String | Yes | The referral code that expired. |
| `participant_id` | String | Yes | The owning Participant. |
| `campaign_id` | String (ULID) | Yes | The associated Campaign. |
| `expired_at` | ISO 8601 | Yes | When the link expired (equals `expires_at`). |
| `total_clicks` | Integer | No | Total `touch.link_clicked` events recorded for this link before expiry. |
| `total_referrals_created` | Integer | No | Total Referral workflow instances created from this link. |

**Consumers:** Analytics (link performance), Dashboard (link status updates).

---

### `link.revoked`

**Purpose:** A referral link was explicitly revoked before its natural expiration. Revocation is immediate and irreversible. Touch events referencing a revoked link receive `403 Forbidden` from the Business Rules Guard (API Contract Section 5.7). Common triggers: operator manually revokes a link, participant is blocked or banned (all links auto-revoked per Product Specification Section 7), fraud detection flags a specific link.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `link_id` | String (ULID) | Yes | The revoked link. |
| `referral_code` | String | Yes | The referral code that was revoked. |
| `participant_id` | String | Yes | The owning Participant. |
| `campaign_id` | String (ULID) | Yes | The associated Campaign. |
| `revocation_reason` | String | Yes | Human-readable reason. Logged in audit trail. |
| `revocation_source` | Enum | Yes | `operator_manual`, `participant_blocked`, `participant_banned`, `fraud_auto`, `campaign_completed`. |
| `revoked_by_id` | String | No | Operator user ID, if `revocation_source` is `operator_manual`. |
| `revoked_at` | ISO 8601 | Yes | When revocation occurred. |

**Consumers:** Analytics, Dashboard (link status updates), Webhook Delivery.

---

## 4.8 Segmentation & Eligibility Events

Produced by the Segmentation domain when segment memberships change or eligibility is evaluated.

**Producing service:** Segmentation.

| Event Type | Purpose | Key Properties |
|------------|---------|----------------|
| `segment.member_added` | Actor entered a segment | `segment_id`, `actor_id`, `actor_type`, `evaluation_mode` (`real_time`, `batch`) |
| `segment.member_removed` | Actor left a segment | `segment_id`, `actor_id`, `actor_type`, `removal_reason` |
| `eligibility.evaluated` | Eligibility verdict computed at a checkpoint | `actor_id`, `variant_id`, `checkpoint` (`campaign_entry`, `referral_creation`, `conversion_validation`, `reward_approval`, `payout`), `eligible` (boolean), `checks` (array of rule results). Checkpoints per Product Specification Section 5. |
| `eligibility.denied` | Actor failed eligibility at a checkpoint | `actor_id`, `variant_id`, `checkpoint`, `failing_rule`, `detail` |
| `variant.resolved` | Actor assigned to a Campaign Variant. Per Product Specification Section 5, this happens at **participant enrollment** (link generation time), not at referee click. Resolution follows the fallback chain: match first variant by priority → multiple matches use allocation_weight → no match falls to default variant → no default = ineligible. | `actor_id`, `campaign_id`, `variant_id`, `is_default_variant` (boolean), `resolution_method` (`priority_match`, `allocation_weight`, `default_fallback`), `hash_value` |

**Consumers:** Workflow Runtime (`eligibility.evaluated`, `variant.resolved`), Analytics (all), AI (segmentation effectiveness).

---

## 4.9 Attribution & Analytics Events

Produced by the Analytics & Attribution domain after processing conversion events and computing attribution.

**Producing service:** Analytics & Attribution.

| Event Type | Purpose | Key Properties |
|------------|---------|----------------|
| `attribution.computed` | Attribution credit assigned for a conversion | `referral_id`, `conversion_event_id`, `model_used` (`first_touch`, `last_touch`, `linear`, `time_decay`, `position_based`, `ai_weighted` — per Product Specification Section 10), `touches` (array of `{ touch_id, participant_id, channel, credit_weight }`), `total_attributed_revenue`, `currency`, `confidence` |
| `kpi.computed` | A KPI metric was recalculated | `kpi_name`, `scope` (`program`, `campaign`, `variant`, `participant`), `scope_id`, `value`, `previous_value`, `period` |
| `analytics.goal_reached` | A Campaign or Program reached a configured goal | `goal_type`, `campaign_id`, `threshold`, `actual_value` |

**Consumers:** Rewards & Payouts (`attribution.computed` — determines reward split in multi-touch), Dashboard (all), AI (attribution quality signals), Webhook Delivery.

---

## 4.10 AI & Optimization Events

Produced by the AI & Optimization domain when it generates recommendations, executes decisions, or updates computed scores. Per Product Specification Section 11, AI features follow guardrails: recommendations require human acceptance, decisions have bounds, and all outputs include reasoning.

**Producing service:** AI & Optimization.

| Event Type | Purpose | Key Properties |
|------------|---------|----------------|
| `ai.recommendation_generated` | AI produced a non-binding suggestion | `recommendation_id`, `type` (`reward_optimization`, `segment_suggestion`, `variant_conclusion`, `campaign_timing`, `fraud_investigation`, `health_alert` — per API Contract Section 3.12), `severity`, `title`, `recommended_action`, `affected_resources` |
| `ai.decision_executed` | AI executed an automated action within guardrails (per Product Specification Section 11, incentive optimization bounds) | `decision_type`, `action_taken`, `affected_resources`, `guardrail_level` (`auto_execute`, `recommend_then_execute`) |
| `ai.fraud_score_updated` | Fraud propensity score recalculated for an actor | `actor_id`, `actor_type`, `previous_score`, `new_score`, `contributing_signals` |
| `ai.health_score_computed` | Program Health Score recalculated (per API Contract Section 3.1, health endpoint) | `program_id`, `score` (0–100), `component_scores` (object with `conversion_rate`, `reward_roi`, `fraud_rate`, `referrer_engagement`, `attribution_quality`, `trend_trajectory`), `trend` (`improving`, `stable`, `declining`) |

**Consumers:** Dashboard (all), Segmentation (`ai.fraud_score_updated` — feeds fraud-based eligibility rules), Workflow Runtime (`ai.decision_executed`), Webhook Delivery (`ai.recommendation_generated`).

---

## 4.11 Campaign & Program Lifecycle Events

Produced when Programs or Campaigns undergo state transitions. Per Product Specification Section 6, the Campaign state machine is: `Draft → Scheduled → Active → Paused → Ended → Archived`. The API Contract (Section 3.2) uses `completed` in place of `Ended` as the implementation state name.

**Producing service:** Program & Campaign Management.

| Event Type | Purpose | Key Properties |
|------------|---------|----------------|
| `program.created` | New Program created | `program_id`, `tenant_id`, `name`, `created_by` |
| `campaign.activated` | Campaign transitioned to Active state | `campaign_id`, `program_id`, `activated_by`, `pulse`, `enrollment_model` (`open`, `selective` — per Product Specification Section 2) |
| `campaign.paused` | Campaign paused | `campaign_id`, `pause_reason`, `paused_by` |
| `campaign.completed` | Campaign finished (Product Specification "Ended", API Contract "completed") | `campaign_id`, `completion_type` (`manual`, `scheduled`, `budget_exhausted`, `goal_reached`), `final_stats` |
| `variant.created` | New Variant added to a Campaign | `variant_id`, `campaign_id`, `is_default` (boolean), `segment_id`, `reward_config_summary` |
| `variant.updated` | Variant configuration changed | `variant_id`, `changed_fields`, `updated_by` |

**Consumers:** Analytics (all), Workflow Runtime (`campaign.activated`, `campaign.paused`, `campaign.completed` — affects active workflows), Webhook Delivery (`campaign.activated`, `campaign.paused`, `campaign.completed`, per API Contract Section 6.2).

---

## 4.12 Identity & Access Events

Produced when users or API keys undergo lifecycle changes.

**Producing service:** Identity & Access.

| Event Type | Purpose | Key Properties |
|------------|---------|----------------|
| `user.registered` | New platform user created | `user_id`, `tenant_id`, `role` |
| `user.logged_in` | User authenticated | `user_id`, `auth_method` |
| `api_key.created` | New API key provisioned (per API Contract Section 2.2) | `key_id`, `key_type` (`secret`, `publishable`), `tenant_id`, `created_by` |
| `api_key.revoked` | API key revoked (immediate, irreversible per API Contract Section 2.2) | `key_id`, `revoked_by`, `revocation_reason` |
| `participant.blocked` | Participant blocked (all links disabled, per API Contract Section 3.5) | `participant_id`, `blocked_by`, `reason` |
| `participant.unblocked` | Participant unblocked | `participant_id`, `unblocked_by` |

**Consumers:** Analytics, Dashboard, Webhook Delivery (`participant.blocked` maps to outbound `referrer.blocked` per API Contract Section 6.2).

---

## 4.13 Compliance & Privacy Events

Produced by the Compliance & Privacy domain in response to consent signals and erasure requests.

**Producing service:** Compliance & Privacy.

| Event Type | Purpose | Key Properties |
|------------|---------|----------------|
| `consent.granted` | Data subject granted tracking consent | `actor_email_hash`, `consent_type` (`tracking`, `marketing`), `consent_source` (`cmp_banner`, `signup_form`, `api`, `widget`) |
| `consent.revoked` | Data subject revoked consent | `actor_email_hash`, `consent_type`, `revocation_scope` (`tracking_only`, `all`) |
| `erasure.requested` | GDPR erasure request submitted (per API Contract Section 3.14). Processed within 30 days per GDPR. | `erasure_request_id`, `actor_email_hash`, `actor_type` (`participant`, `referee`) |
| `erasure.completed` | Erasure processing finished | `erasure_request_id`, `records_anonymized`, `completed_at` |

**Consumers:** Event processing pipeline (`consent.revoked` — stops tracking), Workflow Runtime (`consent.revoked` — may halt active referrals), Analytics, Dashboard.

---

## 4.14 Payout Events

Produced when payout batches undergo lifecycle transitions. Per API Contract Section 3.10, payouts use a two-step confirmation process (create → confirm).

**Producing service:** Rewards & Payouts.

| Event Type | Purpose | Key Properties |
|------------|---------|----------------|
| `payout.created` | New payout batch created | `payout_id`, `total_amount`, `currency`, `item_count`, `fulfillment_method` |
| `payout.confirmed` | Payout batch confirmed for processing | `payout_id`, `confirmed_by` |
| `payout.completed` | Payout batch fully disbursed | `payout_id`, `completed_at`, `total_disbursed` |
| `payout.failed` | Payout batch failed (partial or full) | `payout_id`, `failed_items_count`, `failure_reason` |

**Consumers:** Dashboard, Analytics, Webhook Delivery (`payout.completed`, `payout.failed`, per API Contract Section 6.2).

---

## 4.15 Domain Event ↔ Service Producer/Consumer Matrix

This matrix summarizes which services produce and consume each event domain, aligned with the Product Specification Section 3 (Domain Architecture).

| Event Domain | Producing Service | Consuming Services |
|-------------|-------------------|-------------------|
| `touch.recorded`, `conversion.recorded`, `custom.recorded` | Event Ingestion (Referral Tracking) | Workflow Runtime, Segmentation, Analytics, AI/Fraud |
| `referral.*` | Workflow Runtime | Rewards, Analytics, Segmentation, Webhooks |
| `link.generated`, `link.expired`, `link.revoked` | Referral Workflow Service | Analytics, Dashboard, Webhooks |
| `reward.*` | Rewards & Payouts | Analytics, Dashboard, Webhooks |
| `fraud.*` | AI & Optimization | Workflow Runtime, Rewards, Dashboard, Webhooks |
| `participant.enrolled`, `participant.state_changed`, `participant.trust_tier_changed` | Identity & Access / Program & Campaign | Workflow Runtime, Segmentation, Analytics, Webhooks |
| `segment.*`, `eligibility.*`, `variant.resolved` | Segmentation | Workflow Runtime, Analytics, AI |
| `attribution.*`, `kpi.*`, `analytics.*` | Analytics & Attribution | Rewards (multi-touch split), Dashboard, AI |
| `ai.*` | AI & Optimization | Dashboard, Segmentation, Workflow Runtime, Webhooks |
| `campaign.*`, `program.*`, `variant.created/updated` | Program & Campaign Mgmt | Workflow Runtime, Analytics, Webhooks |
| `user.*`, `api_key.*`, `participant.blocked/unblocked` | Identity & Access | Analytics, Dashboard, Webhooks |
| `consent.*`, `erasure.*` | Compliance & Privacy | Event Pipeline, Workflow Runtime, Analytics |
| `payout.*` | Rewards & Payouts | Dashboard, Analytics, Webhooks |

---

# 5. Attribution Context Object

## 5.1 Purpose

The Attribution Context is a structured object embedded in the canonical event envelope. It connects an event to the referral motion that caused or is associated with it — which Participant, which Campaign, which Variant, which referral link, and which attribution window.

Without this context, an event is an isolated fact. With it, the event is situated within a chain that enables end-to-end tracing from initial click to reward fulfillment.

The Attribution Context is present on all events within a referral workflow (both tracked and domain). It is absent on events outside a referral chain (program configuration events, standalone analytics events, identity events).

## 5.2 Structure

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_id` | String (ULID) | Conditional | The Referral workflow instance this event belongs to. Present once the Referral has been created. Absent on the initial `touch.link_clicked` if the Referral has not yet been instantiated (enriched during processing). |
| `referral_code` | String | Yes | The referral code from the link. Primary linking key between touch events and the Referral they belong to. Always present on events within a referral flow. |
| `participant_id` | String | Conditional | Platform identifier of the Participant. Resolved from `referral_code`. Present once resolution completes. |
| `campaign_id` | String (ULID) | Yes | The Campaign the referral code belongs to. Resolved at ingestion from the referral code registry. |
| `variant_id` | String (ULID) | Conditional | The Campaign Variant the Participant was allocated to. Per Product Specification Section 5, variant resolution happens at participant enrollment (link generation time), not at referee click. Therefore, the `variant_id` is typically resolved from the link's pre-assigned variant, not computed dynamically per touch event. |
| `program_id` | String (ULID) | Yes | The Program that owns the Campaign. Derived from `campaign_id`. |
| `attribution_window_opens_at` | ISO 8601 | No | Timestamp of the first touch in this referral's window. Set once, never changed. |
| `attribution_window_closes_at` | ISO 8601 | No | When the attribution window expires. Computed as `opens_at` + Campaign's configured window duration. Per Product Specification Section 10, default windows are 30 days (click-to-signup), 90 days (click-to-conversion), 60 days (signup-to-conversion). |
| `attribution_model` | Enum | No | `first_touch`, `last_touch`, `linear`, `time_decay`, `position_based`, `ai_weighted`. Per Product Specification Section 10. Included for audit convenience. |
| `touch_sequence_number` | Integer | No | Ordinal position within the Referral's touch sequence (1-indexed). Present on touch events. Enables sequence-based AI models. |

## 5.3 Progressive Enrichment

The Attribution Context is not fully populated at event creation. It is enriched as the referral workflow advances:

**Stage 1 — First Touch.** `referral_code` extracted from the link. Platform resolves `campaign_id`, `program_id`, `participant_id` from the referral code registry. `attribution_window_opens_at` set to `occurred_at`. `attribution_window_closes_at` computed. `referral_id` may not yet exist. `variant_id` typically already resolved (from the link's pre-assigned variant per enrollment-time resolution).

**Stage 2 — Referral Creation.** The Referral workflow instance is created in Temporal. `referral_id` is assigned. From this point, all events carry the full Attribution Context.

**Stage 3 — Conversion and Beyond.** The Attribution Context is frozen on the Referral. Subsequent events (conversion, reward, fulfillment) inherit the same context. `touch_sequence_number` continues to increment on additional touches.

## 5.4 Cross-Event Propagation

- **Touch events** carry the Attribution Context from the moment the referral code is resolved.
- **Conversion events** are linked to a Referral through one of three mechanisms, in order of precedence: (a) explicit `referral_code` in the event, (b) matching `referee_email` or `referee_external_id` to an existing Referral with an open window, (c) session-based matching using `session_id` from prior touches. Per Product Specification Section 9, the platform also supports Method B (Payment Provider Metadata): attribution via Stripe/Paddle/Chargebee customer metadata containing `refrev_ref_code` and `refrev_click_id`.
- **Domain events** (reward, fraud, attribution) inherit Attribution Context from the Referral they pertain to. They do not perform their own attribution.

## 5.5 Window Expiration

When a conversion event's `occurred_at` falls outside `attribution_window_closes_at` of all candidate Referrals for that Referee, no attribution is assigned. The conversion is recorded as organic in the analytics store. No reward is created.

When multiple Referrals have overlapping windows for the same Referee, the configured attribution model determines credit assignment (Product Specification Section 10).

---

# 6. Identity & Actor Modeling

## 6.1 Actor Types

The event model recognizes five actor types, reflecting the actor taxonomy in the Product Specification (Section 4):

| Actor Type | Description | Identity Stability | Primary Event Role |
|------------|-------------|-------------------|--------------------|
| `participant` | External advocate sharing referral links. No platform account. No login. Interacts via links, widgets, emails, magic links, QR codes. | Stable once registered (email + `external_id` within tenant). | Subject of touch.link_shared; recipient of reward events. Actor on all events within their referral chains. |
| `referee` | Person arriving via referral link. Initially anonymous. | Unstable initially (anonymous → tracked → identified). | Subject of touch.link_clicked and conversion events. Progressively resolved through identity stitching. |
| `operator` | Client team member. Per Product Specification Section 4: Super Admin, Program Admin, Campaign Manager, Analyst, Support Agent. | Stable (authenticated platform user via Ory Kratos). | Actor on manual approval, rejection, clawback, and configuration events. |
| `system` | Platform service performing automated actions. | N/A (identified by `producing_service`). | Actor on all derived domain events. |
| `ai_agent` | AI subsystem producing recommendations or decisions. | N/A (identified by model version). | Actor on AI-generated events (recommendations, fraud scores, health scores). |

**Terminology note:** The Product Specification uses "Participant" consistently. The API Contract uses "Referrer" as the resource name (`/v1/referrers`). This event model uses `participant` in the `actor_type` enum. When events are delivered as outbound webhooks, the API Contract's terminology applies (e.g., `referrer.blocked`).

## 6.2 Participant Identity & Lifecycle

Participants are identified by a composite key: `email` + `tenant_id`. The platform assigns a stable `participant_id` (ULID) upon registration — either via explicit API call (`POST /v1/referrers`), bulk registration (`POST /v1/referrers/batch`), or upon first widget interaction (for `open` enrollment campaigns). Once assigned, `participant_id` is immutable and appears in `actor.actor_id` on all related events.

Clients may provide an `external_id` (their own identifier). This is stored for cross-referencing but is not the platform's primary key. If a client registers the same Participant with different `external_id` values, `email` is the deduplication anchor (per API Contract Section 3.5).

Participant identity is linked to the referral code. Every code resolves to exactly one Participant. Touch events carrying a `referral_code` do not need to explicitly identify the Participant — resolution happens automatically.

### Participant Lifecycle States

Per Product Specification Section 7, participants transition through:

| State | Description | Can Refer? | Can Earn? |
|-------|-------------|------------|-----------|
| `candidate` | Identified but not yet active | No | No |
| `active` | Actively participating | Yes | Yes |
| `dormant` | No activity for 90+ days | Yes | Yes |
| `reactivated` | Returned from dormant state | Yes | Yes |
| `flagged` | Under fraud review | Yes | Held |
| `suspended` | Temporarily blocked | No | Held |
| `banned` | Permanently blocked | No | Forfeited |

State transitions are recorded as `participant.state_changed` domain events (Section 4.6).

### Trust Tiers

Per API Contract Section 3.5, participants evolve through trust tiers based on cumulative behavior:

| Tier | Score Range | Key Privileges |
|------|------------|----------------|
| `unknown` | 0 | Initial state, no activity yet |
| `new` | 1–25 | Low payout limits, longer hold periods, full fraud checks |
| `trusted` | 26–60 | Standard limits, standard processing |
| `ambassador` | 61–100 | High limits, priority processing, auto-approval |

Additionally, `flagged` and `blocked` are non-score states driven by fraud signals. Trust tier transitions are recorded as `participant.trust_tier_changed` domain events.

Per Product Specification Section 7, trust score is computed from five components: Account Age (15%), Success Rate (25%), Conversion Quality (20%), Fraud Incidents (25%), Verification (15%).

## 6.3 Referee Identity: The Resolution Problem

Referees present the most complex identity challenge. They arrive as anonymous visitors and are progressively identified through the referral funnel. Per Product Specification Section 4, the referee lifecycle is: Anonymous visitor → Lead → Customer.

**Stage 1: Anonymous.** The Referee clicks a referral link. No PII available. Identity signals: `session_id` (SDK-generated, stored in `_rr_sess` cookie), `anonymous_id` (device fingerprint, if consent granted), IP hash, referral code. Events carry `actor.anonymous_id` but no `actor.actor_id`.

**Stage 2: Email-identified.** The Referee provides their email (signup form, widget, conversion event). Platform creates or matches a Referee record using `email` + `tenant_id`. Events now carry `actor.actor_id` and `actor.actor_email_hash`.

**Stage 3: Externally-identified.** Client backend sends a conversion event with `referee_external_id`. Platform links this to the Referee record. Events can reference the Referee by either `actor_id` or `actor_external_id`.

## 6.4 Identity Stitching

Identity stitching links anonymous pre-identification events to the identified Referee. This is essential for attribution: the first touch may be anonymous, but the conversion is identified. The platform must connect them.

**Stitching rules (in priority order):**

1. **Referral-code-based.** If a conversion event carries a `referral_code`, the platform links the conversion to the Referral associated with that code, regardless of session. Handles cross-device and cross-session scenarios. This is also how Method B (Payment Provider Metadata per Product Specification Section 9) works — the referral code stored in Stripe/Paddle/Chargebee metadata provides the direct link.

2. **Session-based.** When a Referee identifies (provides email), all prior events in the same `session_id` are linked to the Referee's `actor_id`. Highest-confidence method for same-session attribution.

3. **Email-based.** `actor_email_hash` provides a linking key between touch events (where email may have been collected via a form) and conversion events (where email is confirmed). Fallback when session and code are insufficient.

4. **Probabilistic stitching is not performed.** The platform does not use device fingerprinting, IP correlation, or behavioral similarity to stitch identities without an explicit shared identifier. This is deliberate: probabilistic stitching creates false attribution, undermines GDPR compliance, and erodes analytics trust. The platform accepts a small percentage of unstitched events as a tolerable trade-off.

**Stitching immutability.** Identity stitching does not modify existing events. The Referral record is updated with the resolved `referee_id`. All downstream processing operates on the Referral's resolved identity, not on individual event-level actor fields. Original events retain their original `actor` state, preserving the audit trail.

## 6.5 Self-Referral Detection

When the Participant and Referee are the same person, the platform detects this by comparing `participant.email` with `referee.email` (or their hashes) at conversion time. Per Product Specification Section 7, self-referral is a High severity fraud signal (same email, IP, or device fingerprint). Detection produces a `fraud.signal_raised` domain event with `signal_type: self_referral`, triggering the fraud review workflow. It does not modify events.

---

# 7. Versioning & Evolution

## 7.1 Principles

The event schema must evolve as the product grows — new conversion types, new fields for AI features, deprecated fields. The strategy balances forward progress with backward compatibility: consumers processing historical events must not break when new versions appear, and new consumers must process old events.

## 7.2 Scope of `schema_version`

`schema_version` governs the `properties` section of a specific `event_type`. It does not govern the envelope (which has its own stability guarantee per Section 2.2). Each event type has its own independent version lineage. `schema_version: 3` on `conversion.payment_completed` has no relationship to `schema_version: 3` on `touch.link_clicked`.

## 7.3 Backward Compatibility Rules

**Additive changes — do not increment `schema_version`:**

- Adding a new optional field to `properties`.
- Adding a new value to an existing enum (e.g., `tiktok` to `share_channel`).
- Increasing the maximum length of a string field.

Existing consumers ignore unknown fields (open-world assumption, per API Contract Section 1.3). `schema_version` remains unchanged.

**Breaking changes — increment `schema_version`:**

- Adding a new required field.
- Removing an existing field.
- Changing the type of a field.
- Changing the semantics of a field.
- Renaming a field.

The platform continues producing events at the old version for a deprecation period (minimum 6 months, per API Contract Section 1.3).

## 7.4 Consumer Obligations

Consumers must:

- Tolerate unknown fields in `properties` without failure.
- Use `event_type` + `schema_version` as the dispatch key for deserialization.
- Handle missing optional fields gracefully.
- Never assume the set of enum values is closed.
- Handle unknown `event_type` values gracefully (log and skip, not crash) — critical for consumers subscribed to wildcard prefixes like `conversion.*`.

## 7.5 Deprecation Process

1. The field is annotated as deprecated in schema documentation.
2. The platform begins emitting a new field or event type that supersedes the deprecated one.
3. Both coexist for a minimum of 6 months.
4. After deprecation, the old field is no longer emitted on new events. Historical events retain deprecated fields permanently (immutability).

## 7.6 New Event Type Introduction

New event types (e.g., a future `conversion.webinar_attended`) start at `schema_version: 1` and follow their own lineage. Consumers subscribed to wildcards (e.g., `conversion.*`) receive them immediately and must handle gracefully.

## 7.7 Tracked vs Domain Event Evolution

Tracked event schemas evolve independently from domain event schemas. A change to the `properties` of `conversion.payment_completed` (tracked) does not imply a change to `referral.converted` (domain). The two are linked by reference (`conversion_event_id`) not by structural inheritance.

Domain events may add new fields that reference new tracked event fields, but this is always an additive change on the domain event — never a breaking change.

## 7.8 AI Feature Readiness

The schema is designed with future AI capabilities in mind:

- **Flat `properties` structure.** No nested objects ensures trivial feature vector extraction for ML pipelines.
- **Revenue sub-schema.** `mrr`, `arr`, `ltv_estimate` on conversion events provide signals for incentive optimization (per Product Specification Section 11).
- **Fraud score snapshots.** `fraud_score_at_approval` on `reward.approved` creates labeled training data: approved rewards later clawed back provide negative examples.
- **Per-event consent.** Enables models to respect data usage boundaries at feature engineering, not post-hoc.
- **`touch_sequence_number`.** Enables sequence models (LSTMs, transformers) for AI-weighted attribution without reconstructing order from timestamps.
- **Three-tier detection layer field.** `detection_layer` on `fraud.signal_raised` enables cost analysis across rule-based (zero LLM cost), ML-based (zero LLM cost), and LLM-triggered reasoning (expensive, batched).

---

> **Document Status:** Living document. All schemas are working design hypotheses subject to implementation discovery.  
> **Version:** 2.1  
> **Date:** February 2026  
> **Companion Documents:**  
> - Referral Revenue OS Product Specification v3.2  
> - Public API Contract v1.2
