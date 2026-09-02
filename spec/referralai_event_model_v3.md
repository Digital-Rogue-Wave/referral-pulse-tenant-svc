# Formal Event Model — Ingestion & Intra-Service Event Schema

**Document Version:** 3.0 (finalizes and refactors v2.1) 
**Classification:** Internal — Architecture 
**Status:** Implementation-Ready Schema Specification 
**Last Updated:** June 2026 
**Author:** Data Architecture & Event Modeling 
**Companion Documents:** Referral Revenue OS Product Specification v4.3 · Public API Contract v1.3 · Event Model v2.1 (superseded) 
**Audience:** Backend engineers, data engineers, ML engineers, integration architects

---

## Document Purpose

This document is the authoritative, schema-level contract for two and only two event populations: **tracked ingestion events** that enter the platform through the Event Ingestion API, and **domain (intra-service) events** that flow on the internal bus between platform services. It supersedes Event Model v2.1, narrows the model to the ingestion and intra-service surfaces, and resolves the open inconsistencies identified during v2.1 implementation review.

Every externally produced event type defined here in Section 4 has a companion machine-readable JSON Schema describing its `properties` block. Those schemas are maintained as separate artifacts and are normatively bound to the field tables in this document: the schema files and these tables must never disagree.

## Hard Constraints

1. **Append-only.** Events are never deleted, modified, or overwritten once accepted.

2. **Immutable once ingested.** Correction is expressed as a *new* compensating event, never as an edit.

3. **Idempotent by identity.** Deduplication is keyed on `tenant_id` + `external_id`; consumers may safely receive the same event more than once.

4. **Source compatibility.** The model accepts JS SDK events (publishable `rai_pub_` keys), backend events (secret `rai_live_` keys), and webhook-relayed events (billing, email, payout providers) under a single envelope.

## Changes from v2.1

This revision is a finalization, not a redesign. No immutable platform constraint is altered. The substantive changes are:

| # | Change | Rationale |
| --- | --- | --- |
| 1 | **Revenue is flattened.** The v2.1 nested `revenue` sub-object on conversion events is replaced by flat scalar fields (`revenue_amount`, `revenue_currency`, `revenue_type`, `revenue_mrr`, `revenue_arr`, `revenue_ltv_estimate`). | v2.1 §2.1 forbids nested objects in `properties`; v2.1 §7.8 requires flat structure for ML feature extraction. The nested sub-object contradicted both. Flattening reconciles the envelope rule with AI-readiness. |
| 2 | **Scope narrowed** to ingestion events and intra-service domain events. Compliance, identity-access, campaign/program, segmentation, attribution-analytics and AI domain events from v2.1 §4 are referenced but not re-specified here. | Keeps the contract focused on the two surfaces the task targets; the omitted families remain governed by v2.1 §4 until separately finalized. |
| 3 | **External schema set fixed** at ten tracked event types, each with a companion JSON Schema. `widget.viewed` (v2.1 §3.3) is retained on the bus but documented as a link_shared-shaped participant-engagement touch, not re-specified, to keep the JSON file set aligned. | Avoids an undocumented eleventh schema and keeps the file set deterministic. |
| 4 | **Conditional requirements made explicit.** The "email or external id" identity anchor and the "MRR required when recurring" rule are stated as schema-level conditionals. | Removes ambiguity for validator implementers. |

## Table of Contents

1. Event Philosophy

2. Canonical Event Envelope

3. Event Taxonomy: Ingestion vs Intra-Service

4. Tracked Ingestion Event Types

5. Domain / Intra-Service Event Types

6. Attribution Context Object

7. Identity & Actor Modeling

8. Versioning & Evolution

---

# 1. Event Philosophy

## 1.1 The Two Event Worlds

The event model separates events into two categories by origin, trust, and purpose. The separation is structural, not cosmetic: it governs validation, trust enforcement, storage strategy, and which processing pipelines may consume an event.

**Tracked events** are produced outside the platform. They arrive from the client's JS SDK in a browser, from the client's backend, or from external integration relays (email tracking, billing webhooks). They enter through the Event Ingestion API, are authenticated by API keys, and represent raw signals about the client's ecosystem. They are the platform's only window into the external world.

**Domain events** are produced inside the platform by its own services as they validate tracked events, execute workflow logic, compute attribution, evaluate fraud, or perform any internal state transition. They are never submitted by external callers; they are emitted onto the internal bus (SNS/SQS) by the service that performed the action.

**Figure — Ingestion and Intra-Service Event Flow**

```
SOURCES                INGESTION                  EVENT BUS              CONSUMERS
JS SDK (browser) ┐                                                      Workflow Runtime
Client Backend   ├──▶  Event Ingestion        ──▶  Event Bus        ──▶  Rewards & Payouts
Billing Webhook  │     (/v1/events:                (SNS · SQS,            Analytics
Email Relay      ┘      validate · enrich,          durable · ordered)    AI Subsystems
                        deduplicate,                                      Fraud · Compliance
                        trust enforce)

Tracked events emitted to the bus:  touch.recorded · conversion.recorded · custom.recorded
Internal Services (domain producers) also publish domain events:
    referral.* · reward.* · fraud.* · link.* · payout.*
```

## 1.2 What Qualifies as an Event

An event is an immutable, timestamped record of a discrete occurrence that has already happened. An occurrence qualifies when it meets all four tests:

| Test | Meaning |
| --- | --- |
| **Occurred in the past** | `occurred_at` reflects the moment of occurrence in the originating system — set by the external source for tracked events, by the producing service for domain events. |
| **Domain-significant** | It advances a referral workflow, produces attribution or analytics data, represents a business-relevant state change, or generates a signal at least one downstream service consumes. |
| **Self-describing** | Read in isolation with its full payload, it conveys what happened without requiring prior events to decode it. |
| **Idempotent by identity** | It carries identifiers (`event_id` from the platform, `external_id` from the source) that let any consumer safely receive it more than once. |

## 1.3 What Is Explicitly Not an Event

- **Current state.** A referral's status, a participant's trust score, or a pending balance are projections derived from events — materialized views, not events.

- **Configuration mutations.** Renaming a campaign or editing segment rules are audit-log entries. The exception is when a change produces an observable effect on active workflows (e.g. `campaign.activated`); then the *effect* is the event.

- **Queries and reads.** Listing referrals or viewing a dashboard produces no event.

- **Intentions and commands.** A request to approve a reward is a command; it may fail. The event `reward.approved` occurs only after validation and execution.

- **Forecasts and predictions.** Propensity and fraud scores are derived signals. When such a signal triggers an action, the *action* is the event.

- **Processing artifacts.** Queue entries, retry bookkeeping, and dedup cache lookups are infrastructure, not events.

## 1.4 Why Immutability Matters

The model is append-only. Once accepted, an event is never modified, deleted, or overwritten. This is load-bearing for four reasons, plus a correction discipline:

> **Attribution integrity** Attribution is computed from the historical sequence of touch and conversion events. A client disputing a reward must be able to audit the exact, unchanged chain that produced the decision.

> **Audit & GDPR** GDPR requires a verifiable processing record. Erasure is handled by *anonymizing* PII within events (replacing values with opaque tokens), never by deleting events.

> **Deterministic replay** The pipeline reprocesses event ranges to rebuild derived state and backfill analytics. Immutability guarantees identical results on replay.

> **AI training stability** Propensity, fraud, and optimization models train on historical events. Post-hoc mutation would destroy model reproducibility.

> **Correction model** When reality contradicts a recorded event (a chargeback reverses a payment), the platform emits a *new* event — e.g. `reward.reversed`. The original stands. Both are facts.

---

# 2. Canonical Event Envelope

Every event — tracked or domain — conforms to a single top-level envelope. This is the contract between producers and consumers: a consumer routes, filters, and begins processing any event from envelope fields alone, without parsing the domain-specific `properties`. The `properties` block is the only section whose structure varies by `event_type`; it is specified per event type in Sections 4 and 5.

## 2.1 Identity & Type Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `event_id` | String (ULID) | Platform | Globally unique, platform-authoritative identifier. Assigned at ingestion (tracked) or emission (domain). Time-ordered ULID, 26-char Crockford Base32. Primary key in all stores. Assigned once, never changes. |
| `external_id` | String (≤256) | Yes | Source-authoritative deduplication key, scoped to tenant. A second event with the same `tenant_id` + `external_id` inside the 90-day window is a duplicate. Clients set it on tracked events; producing services derive it deterministically for domain events. |
| `schema_version` | Integer | Yes | Version of the `properties` schema for this specific `event_type`. Starts at 1. Governs `properties` only — never the envelope. See Section 8. |
| `event_type` | String (dot-notation) | Yes | Fully qualified type, pattern `{domain}.{action_past_tense}`. Primary routing key; consumers subscribe to types or prefixes (e.g. `reward.*`). Max 128 chars. |
| `event_class` | Enum: `tracked` · `domain` | Yes | Declares external (tracked) vs internal (domain) origin. Authoritative, set by the platform, never overridable by callers. |
| `occurred_at` | ISO 8601 ms UTC | Yes | Moment of occurrence in the source system. Tracked: client timestamp (clock-skew tolerated). Domain: producing-service timestamp. Tracked-event bounds: not >5min future; not older than 7d (touch) or 30d (conversion). |
| `ingested_at` | ISO 8601 ms UTC | Platform | Operational timestamp: when a tracked event cleared validation, or when a domain event was emitted. Used for monitoring, latency, and replay windowing — never for attribution or business logic. |

## 2.2 Source & Trust

The `source` object identifies where an event originated and its trust context. It is the basis for trust-differentiated processing.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `source.origin` | Enum | Yes | `js_sdk`, `client_backend`, `webhook_relay`, `platform_service`. The producing system. |
| `source.trust_level` | Enum | Yes | `high` for secret keys (`rai_live_`), internal services, and verified webhook relays; `low` for publishable keys (`rai_pub_`, browser SDK). Domain events always inherit `high`. |
| `source.api_key_prefix` | String | Conditional | Last four characters of the authenticating key. Present on tracked events, absent on domain events. Full key never stored. |
| `source.sdk_version` | String | No | JS SDK version, for debugging and compatibility. |
| `source.producing_service` | String | Conditional | For domain events: the internal service that produced it (e.g. `workflow-runtime`, `reward-evaluator`, `fraud-detector`). Absent on tracked events. |
| `source.integration_id` | String | No | If relayed from a third-party integration (Stripe, Paddle, Chargebee, CRM), the configured integration identifier. |

## 2.3 Tenant, Actor & Object

Every event belongs to exactly one tenant; tenant isolation is absolute. The `actor` is the entity that caused or is the primary subject of the event; the `object` is the primary domain entity the event pertains to.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tenant.tenant_id` | String (ULID) | Yes | The Client Account. Derived from the authenticating key (tracked) or set by the producing service (domain). |
| `actor.actor_type` | Enum | Yes | `participant`, `referee`, `operator`, `system`, `ai_agent` (Section 7). |
| `actor.actor_id` | String | Conditional | Platform identifier. Present once the actor is identified; absent for anonymous touch events. |
| `actor.actor_external_id` | String | No | The client's own identifier for the actor. Used for stitching. |
| `actor.actor_email_hash` | String | No | SHA-256 of the actor's email. Cross-event linking key before `actor_id` resolution. Raw email never stored in the envelope. |
| `actor.anonymous_id` | String | No | Transient identifier for anonymous actors (session, fingerprint, or cookie token). |
| `object.object_type` | Enum | Yes | `referral`, `reward`, `touch`, `campaign`, `program`, `participant`, `segment`, `payout`, `recommendation`, `variant`. |
| `object.object_id` | String (ULID) | Conditional | Present when the entity exists at event time; may be absent on creation events (enriched during processing). |

**Terminology note.** The Product Spec uses "Participant" for the external advocate; the API Contract names the resource `/v1/referrers`. This model uses `participant` in the `actor_type` enum; both refer to the same entity. Outbound webhooks use the API Contract's term: a blocked referrer surfaces as `participant.suspended` (API Contract §6.1, trigger "Referrer blocked") — there is no `referrer.blocked` webhook.

## 2.4 Context & Consent

The `context` object carries environmental metadata at event time. For `low`-trust tracked events, security-sensitive fields are overridden by server-derived values to prevent client spoofing. The `consent` object records the data subject's consent status, which gates downstream processing.

| Field | Type | Required | Trust | Description |
| --- | --- | --- | --- | --- |
| `context.ip_hash` | String | No | Server-derived (low) | SHA-256 of originating IP. Raw IP never stored. |
| `context.user_agent` | String | No | Server-derived (low) | Full user-agent string. |
| `context.device_type` | Enum | No | Derived | `desktop`, `mobile`, `tablet`, `unknown`. |
| `context.country` / `region` | String | No | Server-derived | ISO 3166-1 alpha-2 country and sub-national region, geo-resolved from IP. |
| `context.page_url` / `referrer_url` | String | No | Client-provided | Page URL (query preserved, fragment stripped) and HTTP referrer. |
| `context.session_id` | String | No | Client-provided | SDK session identifier (`_rr_sess` cookie). Used for touch grouping, secondary dedup, and stitching. |
| `context.locale` | String | No | Client-provided | Browser or system locale (e.g. `de-DE`). |
| `consent.tracking_consent` | Enum | Yes (tracked) | — | `granted`, `denied`, `pending`. Required on all tracked events. Domain events inherit it from their triggering tracked event. |
| `consent.marketing_consent` | Enum | No | — | `granted`, `denied`, `pending`. |
| `consent.consent_source` | Enum | No | — | `cmp_banner`, `signup_form`, `api`, `widget`, `inherited`. |
| `consent.consent_recorded_at` | ISO 8601 | No | — | When the consent signal was captured. |

When `tracking_consent` is `denied`, the event is accepted but processed in restricted mode: no cookies, no fingerprints, no PII linkage, best-effort attribution only.

## 2.5 Payload & Metadata

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `attribution_context` | Object (nullable) | Conditional | The referral chain connecting this event to its Campaign, Variant, Participant, and link. Present on all events within a referral workflow; absent otherwise. Specified in Section 6. |
| `properties` | Object (flat) | Yes | The domain-specific payload. Schema varies by `event_type` (Sections 4 & 5). Max 50 keys, 10 KB. Keys match `^[a-z][a-z0-9_]{0,63}$`. Values are JSON primitives or flat arrays of primitives — **no nested objects**, keeping events queryable in ClickHouse and trivially vectorizable for ML. |
| `metadata` | Object | No | Client-supplied opaque pass-through. Not indexed, not queried, not used for platform logic. Max 20 keys, 5 KB. |

## 2.6 Envelope Stability Rules

The top-level envelope is stable. Within an API version, new top-level fields may be **added** (additive change), but existing fields are never removed, renamed, or retyped. Consumers must tolerate unknown top-level fields (open-world assumption). The `properties` section is the sole exception: it is governed by `schema_version` and evolves per event type per Section 8.

---

# 3. Event Taxonomy: Ingestion vs Intra-Service

## 3.1 Tracked Ingestion Events

Tracked events are submitted to the Event Ingestion API as one of three `type` values. Once an event passes validation, deduplication, trust enforcement, business-rule guards, and enrichment, it is normalized and emitted to the bus as one of three validated forms. These validated forms are the only tracked events downstream services consume.

**Figure — Raw Submission → Validated Bus Form**

```
type: touch       ──normalize──▶  event_type: touch.recorded
type: conversion  ──normalize──▶  event_type: conversion.recorded
type: custom      ──normalize──▶  event_type: custom.recorded

The concrete event_name (e.g. link.clicked, payment.completed) is preserved for precise dispatch.
```

Within each form, the original `event_name` (e.g. `link.clicked`, `payment.completed`) is preserved so consumers can dispatch precisely. Section 4 specifies the ten event_names and their JSON Schemas.

## 3.2 Domain / Intra-Service Events

Domain events are emitted by internal services onto the bus and consumed by other services. They decouple domains (the Workflow Runtime emits `referral.converted`; the Reward service reacts), provide a complete audit trail of platform decisions, feed analytics, and serve as the payload for outbound webhooks. Section 5 specifies the referral, reward, fraud/trust, link, and payout families. Other domain families — campaign/program, segmentation, attribution-analytics, identity-access, compliance, and AI — remain governed by Event Model v2.1 §4 and are out of scope for this finalization. Their outbound webhook names are catalogued in API Contract §6.1 (e.g. `campaign.*`, `recommendation.created`).

## 3.3 Trust Boundaries

Trust enforcement at the ingestion boundary is the platform's primary security control for tracked events. The rules are non-negotiable.

| Source | Key Type | Permitted `type` | Trust | Context Handling |
| --- | --- | --- | --- | --- |
| JS SDK / Browser | Publishable `rai_pub_` | `touch` only | `low` | `ip_hash` and `user_agent` derived server-side; body values ignored. No revenue, no conversion events. |
| Client Backend | Secret `rai_live_` | `touch`, `conversion`, `custom` | `high` | All fields trusted, including revenue and full context. |
| Webhook Relay | Secret (integration) | `conversion`, `custom` | `high` | Relayed from Stripe / Paddle / Chargebee. Webhook signature verified before processing. |

A publishable key submitting a `conversion` event receives **403 Forbidden**. Conversion events determine reward payouts and must originate from a trusted backend.

---

# 4. Tracked Ingestion Event Types

This section defines the ten externally produced tracked events. On the wire each is submitted as the envelope `type` (`touch`, `conversion`, or `custom`) plus an `event_name` in dot-notation, per API Contract §5.1 — the subsection titles below are the `event_name` values. Sections 4.1–4.5 are `touch`, 4.6–4.9 are `conversion`, and 4.10 is the `custom` envelope; on the bus all three normalize to `touch.recorded` / `conversion.recorded` / `custom.recorded` (Section 3.1) with the `event_name` preserved for precise dispatch. Each event has a companion JSON Schema file (`event.<event_name>.schema.json`) describing exactly the `properties` in its table, with mandatory fields in `required` and all other fields implicitly optional. The tables here are normative; the schema files must match them field-for-field. Field groups shared across events — the Referee identity anchor (`referee_email`/`referee_external_id`) and the revenue block — are factored into a common `event._defs.schema.json` and pulled in by `$ref`; each event keeps its property set closed with `unevaluatedProperties` rather than `additionalProperties`, so composition does not break closed-content validation.

**Conditional identity anchor.** Every conversion event must identify the Referee by *at least one* of `referee_email` or `referee_external_id`. Neither alone is unconditionally required, but their disjunction is. In the JSON Schemas this is expressed as an `anyOf` over the two single-field `required` sets, alongside the always-required fields.

## 4.1 link.clicked

**Purpose.** A Referee interacted with a Participant's referral link. The foundational touch event: it opens the attribution window, may instantiate a Referral workflow, and is the primary input to the Attribution Engine.

**Source & trust.** JS SDK (browser, `low`) or client backend via server-side redirect tracking (`high`).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referral_code` | String | Yes | The code embedded in the link. Resolves to a Participant and Campaign. |
| `link_url` | String (uri) | Yes | The full referral link URL that was clicked. |
| `landing_url` | String (uri) | No | Destination URL after redirect. |
| `channel` | Enum | No | `organic_link`, `email`, `social_share`, `widget`, `qr_code`, `api`. Defaults to `organic_link`. |
| `utm_source` | String | No | UTM parameter, if present on the link. |
| `utm_medium` | String | No | UTM parameter, if present. |
| `utm_campaign` | String | No | UTM parameter, if present. |
| `utm_content` | String | No | UTM parameter, if present. |
| `utm_term` | String | No | UTM parameter, if present on the link. |
| `is_repeat_visit` | Boolean | No | Whether the Referee clicked this code before (session/cookie-detected). |

**Validation & dedup.** `referral_code` must resolve to an active or recently-expired campaign (grace-period attribution). Envelope `consent` required. For publishable keys, `ip_hash`/`user_agent` are server-overridden. Secondary dedup key: `referral_code + session_id + 5min_bucket`.

**Feeds.** Workflow Runtime (route/create Referral), Attribution Engine (touch recording), Fraud Detection (velocity/IP), Analytics (funnel top), Segmentation.

## 4.2 link.shared

**Purpose.** A Participant actively shared their referral link through a trackable channel. Sharing is the Participant's action (clicking is the Referee's); it powers engagement analytics and propensity modeling. The participant-side `widget.viewed` event (v2.1 §3.3) shares this event's shape and trust profile and travels on the bus, but is not re-specified here.

**Source & trust.** JS SDK widget share button (`low`) or client backend programmatic share tracking (`high`).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referral_code` | String | Yes | The code that was shared. |
| `share_channel` | Enum | Yes | `email`, `twitter`, `linkedin`, `facebook`, `whatsapp`, `copy_link`, `sms`, `custom`. |
| `share_url` | String (uri) | No | The full URL shared, if it differs from the canonical link. |
| `recipient_count` | Integer (≥0) | No | Number of recipients, if determinable. |

**Feeds.** Analytics (participant engagement), AI (propensity, channel effectiveness), Participant Lifecycle, Segmentation.

## 4.3 page.viewed

**Purpose.** A Referee viewed a page on the client's site while a referral session is active. Provides engagement-depth signal for multi-touch attribution and propensity modeling — weaker than a click, but a valid sequence member when a referral code is in session. Retained as a first-class tracked event.

**Source & trust.** JS SDK (browser, `low`) or client backend (`high`).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referral_code` | String | Yes | From the active session cookie (`_rr_ref`). |
| `page_url` | String (uri) | Yes | The URL viewed. |
| `page_title` | String | No | The HTML page title. |
| `time_on_page_ms` | Integer (≥0) | No | Milliseconds on the previous page, set on navigation away. |

**Feeds.** Attribution Engine (engagement depth for AI-weighted model), Analytics (funnel depth), Fraud Detection (session-pattern analysis).

## 4.4 email.opened

**Purpose.** A Referee opened an email invitation sent by, or on behalf of, a Participant. Mid-funnel engagement signal that strengthens the attribution chain. Captured via tracking pixel.

**Source & trust.** Platform email service (tracking pixel), arriving as a webhook relay or platform-service call. `high`.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referral_code` | String | Yes | The code associated with the invitation. |
| `invitation_id` | String | Yes | Platform identifier for the specific invitation. |
| `email_template_id` | String | No | The template used. |
| `open_count` | Integer (≥1) | No | Cumulative open count. Only the first open is attribution-significant. |

**Feeds.** Attribution Engine (weighted touch), Analytics (email funnel), Participant Lifecycle.

## 4.5 email.clicked

**Purpose.** A Referee clicked a link inside an email invitation — a stronger engagement signal than an open. Captured via redirect through a tracking URL.

**Source & trust.** Platform email service (redirect handler). `high`.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referral_code` | String | Yes | The code associated with the invitation. |
| `invitation_id` | String | Yes | Platform identifier for the invitation. |
| `link_id` | String | Yes | Identifier for the specific link within the email. |
| `destination_url` | String (uri) | Yes | The URL the link resolved to. |

**Feeds.** Attribution Engine (weighted touch — higher weight than an open), Analytics (email funnel conversion), Participant Lifecycle.

## 4.6 signup.completed

**Purpose.** A Referee completed signup in the client's product. Primary conversion for the Signup Pulse and entry event for the Conversion Pulse (trial-to-paid).

**Source & trust.** Client backend only (secret key). `high`, mandatory.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referee_email` | String (email) | Conditional | Required unless `referee_external_id` is provided. Links the conversion to the Referral via prior touches. |
| `referee_external_id` | String | Conditional | Client's identifier for the Referee. Required unless `referee_email` is provided. |
| `referral_code` | String | No | If known, enables direct attribution without matching. |
| `signup_method` | Enum | No | `email`, `google_oauth`, `saml_sso`, `github`, `custom`. |
| `plan_type` | String | No | Plan or tier signed up for (e.g. `free`, `trial`, `starter`). |
| `account_type` | Enum | No | `individual`, `team`, `enterprise`. |

**Feeds.** Workflow Runtime (state transition), Eligibility Engine, Fraud Detection, Reward Evaluator, Analytics (conversion funnel), Segmentation.

## 4.7 payment.completed

**Purpose.** A Referee completed a payment, moving from free/trial to paying. Primary conversion for the Conversion Pulse; enrichment for the Signup Pulse when rewards depend on payment.

**Source & trust.** Client backend or verified billing webhook relay. `high`, mandatory.

**Revenue is flat.** Revenue is expressed as flat `revenue_*` scalar fields, not a nested object, per the envelope's no-nested-objects rule and AI-readiness requirements.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referee_email` | String (email) | Conditional | Required unless `referee_external_id` is provided. |
| `referee_external_id` | String | Conditional | Required unless `referee_email` is provided. |
| `referral_code` | String | No | For direct attribution. |
| `revenue_amount` | Integer (≥0) | Yes | Payment amount in minor currency units (cents). |
| `revenue_currency` | String (ISO 4217) | Yes | Three-letter currency code (`^[A-Z]{3}$`). |
| `revenue_type` | Enum | Yes | `one_time`, `recurring`. |
| `revenue_mrr` | Integer (≥0) | Conditional | Monthly recurring revenue in minor units. **Required when `revenue_type` is `recurring`**. Annual payments: annual ÷ 12, rounded down. |
| `revenue_arr` | Integer (≥0) | No | Annual recurring revenue in minor units. |
| `revenue_ltv_estimate` | Integer (≥0) | No | Client-provided lifetime-value estimate in minor units. Used by AI for reward optimization. |
| `payment_provider` | Enum | No | `stripe`, `paddle`, `chargebee`, `paypal`, `wire`, `custom`. |
| `payment_external_id` | String | No | Payment identifier in the client's billing system. |
| `plan_id` | String | No | The plan the payment is for. |
| `plan_name` | String | No | Human-readable plan name. |
| `billing_interval` | Enum | No | `monthly`, `quarterly`, `annual`, `one_time`, `custom`. |
| `is_first_payment` | Boolean | No | Whether this is the Referee's first-ever payment. |
| `trial_converted` | Boolean | No | Whether this represents a trial-to-paid conversion. |

**Feeds.** Workflow Runtime, Reward Evaluator (revenue-based calculation), Attribution Engine (revenue attribution), Analytics (revenue KPIs), AI (LTV modeling, incentive optimization), Segmentation.

## 4.8 subscription.renewed

**Purpose.** An existing subscriber renewed. Primary conversion for the Renewal Pulse; can trigger rewards when referred-customer retention is a rewarded outcome. Uses the same flat `revenue_*` fields as §4.7.

**Source & trust.** Client backend or verified billing webhook relay. `high`, mandatory.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referee_email` | String (email) | Conditional | Required unless `referee_external_id` is provided. |
| `referee_external_id` | String | Conditional | Required unless `referee_email` is provided. |
| `referral_code` | String | No | If known. |
| `revenue_amount` | Integer (≥0) | Yes | Renewal amount in minor units. |
| `revenue_currency` | String (ISO 4217) | Yes | Three-letter currency code. |
| `revenue_type` | Enum | Yes | `one_time`, `recurring`. |
| `revenue_mrr` | Integer (≥0) | Conditional | Required when `revenue_type` is `recurring`. |
| `revenue_arr` | Integer (≥0) | No | Annual recurring revenue in minor units. |
| `revenue_ltv_estimate` | Integer (≥0) | No | Lifetime-value estimate in minor units. |
| `renewal_number` | Integer (≥1) | No | Times renewed (1 for first renewal). |
| `previous_plan_id` | String | No | Plan before renewal, if changed. |
| `new_plan_id` | String | No | Plan after renewal. |
| `retention_days` | Integer (≥0) | No | Days continuously active. |

**Feeds.** Workflow Runtime, Reward Evaluator (renewal-linked rewards, revenue-share duration), Attribution Engine (recurring revenue), Analytics, AI (churn propensity), Segmentation.

## 4.9 feedback.submitted

**Purpose.** A user submitted a review, rating, NPS response, or testimonial. Conversion for the Feedback Pulse; non-monetary or low-value rewards expected.

**Source & trust.** Client backend only. `high`.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referee_email` | String (email) | Conditional | Required unless `referee_external_id` is provided. |
| `referee_external_id` | String | Conditional | Required unless `referee_email` is provided. |
| `feedback_type` | Enum | Yes | `review`, `rating`, `nps`, `testimonial`, `survey`, `custom`. |
| `rating_value` | Number | No | Numeric rating (e.g. 4.5). |
| `rating_scale_max` | Number | Conditional | Maximum scale value. **Required when `rating_value` is present.** |
| `nps_score` | Integer (0–10) | No | NPS score. Present only for `feedback_type: nps`. |
| `feedback_platform` | String | No | Where submitted (e.g. `g2`, `capterra`, `trustpilot`, `in_app`). |
| `has_text_content` | Boolean | No | Whether feedback includes written text. Text itself is not stored in the event. |
| `is_verified_purchase` | Boolean | No | Whether the reviewer is a verified customer. |

**Feeds.** Workflow Runtime, Reward Evaluator, Analytics (engagement KPIs), AI (quality/spam signals), Segmentation.

## 4.10 custom.recorded

**Purpose.** A generic behavioral signal that feeds segmentation, propensity models, and analytics but does not directly drive referral workflow transitions. The mechanism by which clients communicate product usage, lifecycle changes, and other activity.

**Source & trust.** Client backend only (secret key). `high`.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `event_name` | String (dot-notation) | Yes | Client-defined behavioral name (e.g. `session.started`, `plan.upgraded`, `subscription.cancelled`). Pattern `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$`. |
| `actor_email` | String (email) | No | Email of the user who performed the action. Used for identity linking. |
| `actor_external_id` | String | No | Client's identifier for the actor. |
| *Additional client-defined keys* — flat primitives or primitive arrays — are permitted alongside the above, subject to the envelope `properties` limits (50 keys, 10 KB). No nested objects. |  |  |  |

**Feeds.** Segmentation (rule evaluation, membership), Analytics (ClickHouse), AI (feature engineering). Custom events do **not** reach the Workflow Runtime directly; when a custom event matches a running Pulse trigger, the Segmentation service emits a separate `conversion.recorded` domain event — the translation is explicit.

---

# 5. Domain / Intra-Service Event Types

Domain events are produced by internal services and flow on the bus. They are never submitted by external callers. Each definition states its purpose, producing service, consuming domains, and `properties`. They carry the shared envelope; `event_class` is always `domain` and `source.trust_level` is always `high`. No JSON Schema files are produced for these — schema files are required only for externally produced ingestion events.

## 5.1 Referral Lifecycle

**Producing service:** Referral Workflow Runtime (Temporal). **State machine:** `created → qualified → converted → rewarded`, with branches to `rejected` and `expired`. (Product Spec §2 names these lifecycle states *Pending → Qualified → Converted → Rewarded | Expired | Rejected*; `referral.created` enters the *Pending* state. Reward reversal is modelled at the reward level as `reward.reversed`, not as a referral state.)

**Figure — Referral State Machine**

```
created ──eligible──▶ qualified ──conversion──▶ converted ──reward──▶ rewarded
   │                      │
   ▼                      ▼
expired                 rejected
(window)                (ineligible / fraud)

Product Spec §2 lifecycle states: Pending → Qualified → Converted → Rewarded | Expired | Rejected
(referral.created enters the Pending state; reward reversal is modelled at the reward level as reward.reversed)
```

### referral.created

A new Referral workflow instance was created — on the first touch for a new Participant→Referee→Campaign combination, or explicitly via server-side API. **Consumers:** Analytics, Segmentation, Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referral_id` | String (ULID) | Yes | The new Referral identifier. |
| `participant_id` | String | Yes | The owning Participant. |
| `campaign_id` | String (ULID) | Yes | The Campaign this referral belongs to. |
| `variant_id` | String (ULID) | No | Resolved variant (typically pre-resolved at link generation). |
| `referee_email_hash` | String | No | SHA-256 of Referee email, if known at creation. |
| `referee_external_id` | String | No | Client's Referee identifier, if known. |
| `referral_code` | String | Yes | The code that initiated this referral. |
| `first_touch_at` | ISO 8601 | Yes | Timestamp of the initiating touch. |
| `creation_source` | Enum | Yes | `touch_event`, `api_explicit`, `webhook_relay`. |

### referral.qualified

The Referral passed eligibility at a checkpoint. **Consumers:** Analytics, Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referral_id` | String (ULID) | Yes | The Referral that passed. |
| `eligibility_result` | Enum | Yes | `eligible`. |
| `checkpoint` | Enum | Yes | `campaign_entry`, `referral_creation`, `conversion_validation`, `reward_approval`, `payout`. |
| `rules_evaluated` | Array | Yes | Per-rule evaluation trace for audit (rule name, pass/fail, detail). |
| `evaluated_at` | ISO 8601 | Yes | When eligibility was computed. |

### referral.converted

A conversion was matched and validated against this Referral; triggers reward evaluation. **Consumers:** Rewards & Payouts, Fraud Detection, Analytics, AI, Segmentation, Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referral_id` | String (ULID) | Yes | The Referral that converted. |
| `conversion_event_id` | String (ULID) | Yes | `event_id` of the triggering `conversion.recorded` event. |
| `conversion_type` | String | Yes | The concrete conversion type (e.g. `payment.completed`). |
| `revenue_amount` | Integer (≥0) | No | Attributed revenue in minor units, if the conversion carried revenue. |
| `revenue_currency` | String (ISO 4217) | Conditional | Required when `revenue_amount` is present. |
| `converted_at` | ISO 8601 | Yes | Timestamp of conversion. |
| `attribution_model_used` | Enum | No | `first_touch`, `last_touch`, `linear`, `time_decay`, `position_based`, `ai_weighted`. |

### referral.rejected

The Referral was rejected — failed eligibility, confirmed fraud, or manual operator action. **Consumers:** Analytics, Webhook Delivery, AI (fraud feedback).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referral_id` | String (ULID) | Yes | The rejected Referral. |
| `rejection_reason` | String | Yes | Human-readable reason. |
| `rejection_source` | Enum | Yes | `eligibility_engine`, `fraud_detection`, `operator_manual`. |
| `rejected_by_id` | String | No | Operator ID, if `operator_manual`. |

### referral.expired

The attribution window passed without a matching conversion; the Referral is closed. **Consumers:** Analytics, Webhook Delivery, AI (negative examples).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referral_id` | String (ULID) | Yes | The expired Referral. |
| `window_days` | Integer | Yes | Attribution window duration in effect. |
| `first_touch_at` | ISO 8601 | Yes | When the window opened. |
| `last_touch_at` | ISO 8601 | No | Most recent touch before expiry. |
| `touch_count` | Integer | Yes | Total touches recorded before expiry. |

## 5.2 Reward Lifecycle

**Producing service:** Rewards & Payouts. **State machine:** `earned → pending_approval → approved → processing → paid`, with branches to `rejected` and `reversed`.

**Figure — Reward State Machine**

```
earned ──▶ pending_approval ──approve──▶ approved ──dispatch──▶ processing ──delivered──▶ paid
              │                                                                    │
              ▼                                                                    ▼
           rejected                                                             reversed
           (denied)                                                             (chargeback)
```

*State/term mapping: `earned`/`pending_approval` correspond to Product Spec §8 *Pending* and API Contract §6.1 `reward.calculated`/`reward.held`; `processing → paid` map to *Processing → Paid* and `reward.paid`; `reversed` maps to *Reversed* and `reward.reversed`.*

### reward.earned

A Reward instance was created from the Variant's Reward Configuration; conversion validated and amount computed. **Consumers:** Approval Engine, Analytics, Dashboard, Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `reward_id` | String (ULID) | Yes | The new Reward. |
| `referral_id` | String (ULID) | Yes | The triggering Referral. |
| `recipient_type` | Enum | Yes | `participant`, `referee`. |
| `recipient_id` | String | Yes | Platform ID of the recipient. |
| `reward_type` | Enum | Yes | `cash`, `gift_card`, `account_credit`, `feature_unlock`, `extended_trial`, `discount_code`, `custom`. *What* the participant receives (Product Spec §8, DB Model). |
| `reward_structure` | Enum | Yes | `fixed`, `percentage`, `tiered`, `recurring`, `milestone`, `capped`. *How* the amount is computed (Product Spec §8, DB Model). |
| `amount` | Integer (≥0) | Yes | Calculated value in minor units. Zero for non-monetary. |
| `currency` | String (ISO 4217) | Conditional | Required when `amount` > 0. |
| `approval_mode` | Enum | Yes | `auto`, `manual`, `auto_below_threshold`, `ai_assisted`. |
| `auto_approval_eligible` | Boolean | Yes | Whether it qualifies for automatic approval. |
| `triggering_conversion_event_id` | String (ULID) | Yes | `event_id` of the triggering conversion. |

### reward.pending_approval

The Reward entered the manual or AI-assisted approval queue (auto-approved rewards skip this state). **Consumers:** Dashboard, Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `reward_id` | String (ULID) | Yes | The Reward awaiting approval. |
| `referral_id` | String (ULID) | Yes | Associated Referral. |
| `approval_mode` | Enum | Yes | `manual`, `ai_assisted`. |
| `cooling_period_ends_at` | ISO 8601 | No | When the reward becomes eligible for approval, if a cooling period is configured. |
| `fraud_score_at_submission` | Number (0–1) | No | Participant fraud score on entering the queue. |

### reward.approved

The Reward was approved for fulfillment — automatically, via AI assessment, or by an operator. **Consumers:** Fulfillment Engine, Analytics, AI (feedback), Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `reward_id` | String (ULID) | Yes | The approved Reward. |
| `referral_id` | String (ULID) | Yes | Associated Referral. |
| `approved_by_type` | Enum | Yes | `system_auto`, `ai_assisted`, `operator`. |
| `approved_by_id` | String | No | Operator ID, if `operator`. |
| `approval_reason` | String | No | Human or AI-generated explanation. |
| `fraud_score_at_approval` | Number (0–1) | No | Fraud score at approval; recorded for audit and AI training. |
| `amount` | Integer (≥0) | Yes | Approved amount (may differ from earned if adjusted). |
| `currency` | String (ISO 4217) | Conditional | Required when `amount` > 0. |

### reward.rejected

The Reward was rejected during approval; the Participant is not paid. **Consumers:** Analytics, AI (feedback), Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `reward_id` | String (ULID) | Yes | The rejected Reward. |
| `referral_id` | String (ULID) | Yes | Associated Referral. |
| `rejected_by_type` | Enum | Yes | `system_auto`, `ai_assisted`, `operator`. |
| `rejected_by_id` | String | No | Operator ID, if manual. |
| `rejection_reason` | String | Yes | Logged in the immutable audit trail. |

### reward.paid

The payout was successfully disbursed. **Consumers:** Analytics, Participant Lifecycle, Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `reward_id` | String (ULID) | Yes | The fulfilled Reward. |
| `referral_id` | String (ULID) | Yes | Associated Referral. |
| `fulfillment_method` | Enum | Yes | `paypal`, `wise`, `sepa`, `gift_card`, `credit`, `discount_code`, `manual`. |
| `external_transfer_id` | String | No | Transfer identifier from the provider. |
| `fulfilled_at` | ISO 8601 | Yes | When disbursement completed. |
| `amount` | Integer (≥0) | Yes | Fulfilled amount in minor units. |
| `currency` | String (ISO 4217) | Conditional | Required when `amount` > 0. |

### reward.reversed

A previously fulfilled Reward was reversed — chargeback, refund within the clawback window, or confirmed post-payout fraud. **Consumers:** Analytics, Participant Lifecycle, Payout (negative balance), Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `reward_id` | String (ULID) | Yes | The clawed-back Reward. |
| `referral_id` | String (ULID) | Yes | Associated Referral. |
| `clawback_reason` | String | Yes | Mandatory. Logged in the immutable audit trail. |
| `clawback_amount` | Integer (≥0) | Yes | Amount clawed back in minor units; may be less than fulfilled for partial. |
| `currency` | String (ISO 4217) | Yes | Currency of the clawback. |
| `initiated_by_type` | Enum | Yes | `system_auto`, `operator`. |
| `initiated_by_id` | String | No | Operator ID, if manual. |

## 5.3 Fraud & Trust

Fraud events are *signals*, not verdicts: they trigger review flows and inform reward approval. Fraud detection is per-event/per-referral (risk score 0.0–1.0); the trust model is per-participant (cumulative score 0–100). **Producing service:** AI & Optimization (fraud detection) for signals; Identity & Access / Program & Campaign for participant-state and trust-tier changes.

### fraud.flagged

The fraud subsystem identified a suspicious pattern; may auto-hold pending rewards. **Consumers:** Workflow Runtime, Rewards & Payouts, Dashboard, Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `signal_type` | Enum | Yes | `self_referral`, `velocity_abuse`, `disposable_email`, `vpn_proxy`, `device_fingerprint_match`, `payment_reversal`, `geographic_mismatch`, `bot_pattern`, `collusion_pattern`, `reward_harvesting`. |
| `severity` | Enum | Yes | `low`, `medium`, `high`, `critical`. |
| `referral_id` | String (ULID) | No | The Referral under suspicion, if applicable. |
| `participant_id` | String | No | The Participant under suspicion, if applicable. |
| `detection_layer` | Enum | Yes | `rule_based`, `ml_based`, `aggregate_analysis`. |
| `evidence` | Array | Yes | Flat key/value evidence pairs (e.g. `device_count=15`, `referrals_last_hour=47`). |
| `fraud_checkpoint` | Enum | No | `referral_creation`, `qualification`, `reward_approval`, `payout`. |
| `auto_action_taken` | Enum | No | `reward_held`, `participant_flagged`, `auto_blocked`, `none`. |

### participant.state_changed

A Participant transitioned between lifecycle states. **Consumers:** Workflow Runtime, Analytics, Segmentation, Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `participant_id` | String | Yes | The Participant. |
| `previous_state` | Enum | Yes | Prior state. |
| `new_state` | Enum | Yes | `active`, `dormant`, `flagged`, `suspended`, `banned` — the operational axis (API Contract §3.5). `candidate` is a client-side journey stage and `reactivated` is the Dormant→Active transition, not operational states. |
| `reason` | String | No | Human-readable reason. |
| `changed_by` | String | No | Operator or system identifier. |

### participant.trust_changed

A Participant's trust tier was updated from cumulative behavior. **Consumers:** Segmentation (trust-based eligibility), Analytics, Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `participant_id` | String | Yes | The Participant. |
| `previous_tier` | Enum | Yes | Prior tier. |
| `new_tier` | Enum | Yes | `unknown`, `new`, `trusted`, `ambassador`. |
| `trust_score` | Integer (0–100) | Yes | New cumulative trust score. |
| `contributing_factors` | Array | No | Flat factor weights contributing to the change. |

*Outbound mapping (API Contract §6.1): `fraud.flagged`, `participant.trust_changed`, and the `suspended` transition of `participant.state_changed` (surfaced as `participant.suspended`) are the webhook-delivered names; the internal bus carries the events as specified above.*

## 5.4 Link Lifecycle

**Producing service:** Referral Workflow Service. Each link binds a `referral_code` to a Participant, Campaign, and Variant.

### link.generated

A new referral link was created — usually at enrollment, or by operator API call. **Consumers:** Analytics, Dashboard, Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `link_id` | String (ULID) | Yes | The unique link identifier. |
| `referral_code` | String | Yes | The generated code. Unique within tenant. |
| `participant_id` | String | Yes | The owning Participant. |
| `campaign_id` | String (ULID) | Yes | Associated Campaign. |
| `variant_id` | String (ULID) | Yes | Variant resolved at generation. |
| `link_url` | String (uri) | Yes | The full referral link URL. |
| `channel` | Enum | No | `link`, `email`, `widget`, `api`. |
| `custom_slug` | String | No | Vanity slug, if requested. |
| `expires_at` | ISO 8601 | No | When the link expires. Null if it does not expire. |
| `generation_source` | Enum | Yes | `enrollment`, `api_explicit`, `sdk_widget`, `bulk_generation`. |

### link.expired

A link passed its `expires_at` and is no longer valid for new touches; existing Referrals are unaffected. **Consumers:** Analytics, Dashboard.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `link_id` | String (ULID) | Yes | The expired link. |
| `referral_code` | String | Yes | The code that expired. |
| `participant_id` | String | Yes | The owning Participant. |
| `campaign_id` | String (ULID) | Yes | Associated Campaign. |
| `expired_at` | ISO 8601 | Yes | When the link expired. |
| `total_clicks` | Integer (≥0) | No | Total clicks before expiry. |
| `total_referrals_created` | Integer (≥0) | No | Referrals created from this link. |

### link.revoked

A link was explicitly revoked before natural expiry; immediate and irreversible. **Consumers:** Analytics, Dashboard, Webhook Delivery.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `link_id` | String (ULID) | Yes | The revoked link. |
| `referral_code` | String | Yes | The code that was revoked. |
| `participant_id` | String | Yes | The owning Participant. |
| `campaign_id` | String (ULID) | Yes | Associated Campaign. |
| `revocation_reason` | String | Yes | Human-readable reason. Audit-logged. |
| `revocation_source` | Enum | Yes | `operator_manual`, `participant_blocked`, `participant_banned`, `fraud_auto`, `campaign_completed`. |
| `revoked_by_id` | String | No | Operator ID, if `operator_manual`. |
| `revoked_at` | ISO 8601 | Yes | When revocation occurred. |

## 5.5 Payouts

**Producing service:** Rewards & Payouts. Payouts use a two-step create→confirm process. **Consumers:** Dashboard, Analytics, Webhook Delivery.

| Event | Key Properties |
| --- | --- |
| `payout.created` | `payout_id` (req), `total_amount` (req, minor units), `currency` (req), `item_count` (req), `fulfillment_method` (req) |
| `payout.confirmed` | `payout_id` (req), `confirmed_by` (req) |
| `payout.completed` | `payout_id` (req), `completed_at` (req), `total_disbursed` (req, minor units) |
| `payout.failed` | `payout_id` (req), `failed_items_count` (req), `failure_reason` (req) |

*Outbound mapping (API Contract §6.1): `payout.created` surfaces as the `payout.sent` webhook; `payout.completed` reflects provider confirmation; `payout.failed` maps directly; `payout.confirmed` is internal-only.*

---

# 6. Attribution Context Object

The Attribution Context is a structured object in the envelope that situates an event within a referral motion — which Participant, Campaign, Variant, link, and attribution window. Without it an event is an isolated fact; with it the event is a node in a chain traceable from first click to reward fulfillment. It is present on all events within a referral workflow (tracked and domain) and absent on events outside any referral chain.

## 6.1 Structure

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `referral_id` | String (ULID) | Conditional | The Referral instance this event belongs to. Present once the Referral exists; absent on the initial `link.clicked` before instantiation (enriched during processing). |
| `referral_code` | String | Yes | The code from the link. Primary linking key between touches and their Referral. Always present within a referral flow. |
| `participant_id` | String | Conditional | Resolved from `referral_code`; present once resolution completes. |
| `campaign_id` | String (ULID) | Yes | The Campaign the code belongs to. Resolved at ingestion. |
| `variant_id` | String (ULID) | Conditional | The Variant the Participant was allocated to. Resolved at enrollment (link generation), not per touch. |
| `program_id` | String (ULID) | Yes | The Program owning the Campaign. Derived from `campaign_id`. |
| `attribution_window_opens_at` | ISO 8601 | No | First touch in the window. Set once, never changed. |
| `attribution_window_closes_at` | ISO 8601 | No | `opens_at` + the Campaign's configured window duration. |
| `attribution_model` | Enum | No | `first_touch`, `last_touch`, `linear`, `time_decay`, `position_based`, `ai_weighted`. Included for audit convenience. |
| `touch_sequence_number` | Integer (≥1) | No | 1-indexed ordinal within the Referral's touch sequence. Present on touch events; enables sequence-based AI models. |

## 6.2 Progressive Enrichment

The context is not fully populated at creation; it is enriched as the workflow advances.

- **First touch.** `referral_code` extracted from the link; platform resolves `campaign_id`, `program_id`, `participant_id` from the code registry. `attribution_window_opens_at` set to `occurred_at`; `closes_at` computed. `variant_id` typically already resolved from the link. `referral_id` may not yet exist.

- **Referral creation.** The workflow instance is created in Temporal; `referral_id` is assigned. From here, all events carry the full context.

- **Conversion and beyond.** The context is frozen on the Referral. Conversion, reward, and fulfillment events inherit it unchanged; `touch_sequence_number` continues to increment on additional touches.

**Figure — Attribution Context Following a Referral Through Its Lifecycle**

```
link.clicked ─▶ referral.created ─▶ signup.completed ─▶ payment.completed ─▶ reward.approved ─▶ reward.paid

Carried context — copied unchanged onto every event above:
    referral_id · referral_code · campaign_id · participant_id
```

## 6.3 Cross-Event Propagation & Window Expiry

Touch events carry the context from the moment the code resolves. Conversion events link to a Referral, in precedence order, by: (a) explicit `referral_code` — including payment-provider metadata (Method B) carrying the code in Stripe/Paddle/Chargebee customer metadata; (b) `click_id` correlation to the originating click; (c) session/cookie matching via `session_id`; (d) `referee_email`/`referee_external_id` matched to a Referral with an open window; (e) no match — recorded as organic. This order mirrors Product Spec §10 (Attribution Resolution Priority). Domain events inherit the context from the Referral they pertain to; they never perform their own attribution.

When a conversion's `occurred_at` falls outside every candidate Referral's window, no attribution is assigned: the conversion is recorded as organic and no reward is created. When multiple Referrals have overlapping windows for the same Referee, the configured attribution model assigns credit.

---

# 7. Identity & Actor Modeling

## 7.1 Actor Types

| Actor Type | Description | Identity Stability | Primary Event Role |
| --- | --- | --- | --- |
| `participant` | External advocate sharing links. No platform login; interacts via links, widgets, emails, QR codes. | Stable once registered (`email` + `external_id` within tenant). | Subject of `link.shared`; recipient of reward events. |
| `referee` | Person arriving via a referral link. Initially anonymous. | Unstable initially (anonymous → tracked → identified). | Subject of `link.clicked` and conversion events. |
| `operator` | Client team member (admin, marketer, analyst, support). | Stable (authenticated platform user). | Actor on manual approval, rejection, clawback, configuration. |
| `system` | Platform service performing automated actions. | N/A (identified by `producing_service`). | Actor on derived domain events. |
| `ai_agent` | AI subsystem producing recommendations or decisions. | N/A (identified by model version). | Actor on AI-generated events. |

## 7.2 Referee Identity: The Resolution Problem

Referees are the hardest identity case: they arrive anonymous and are progressively identified through the funnel.

**Figure — Referee Identity Lifecycle**

```
Anonymous  ─▶  Email-identified  ─▶  Externally-identified  ─▶  Linked to Referral
session_id     actor_id +            + external_id              resolved referee_id
anonymous_id   email_hash

(progressive identification through the funnel)
```

> **Anonymous.** Click with no PII. Signals: `session_id` (`_rr_sess`), `anonymous_id` (fingerprint, if consented), IP hash, referral code. Events carry `actor.anonymous_id`, no `actor.actor_id`.

> **Email-identified.** Referee provides email (form, widget, conversion). Platform creates or matches a Referee on `email` + `tenant_id`. Events now carry `actor.actor_id` and `actor.actor_email_hash`.

> **Externally-identified.** Backend sends a conversion with `referee_external_id`. Platform links it to the Referee; events can reference either `actor_id` or `actor_external_id`.

## 7.3 Identity Stitching & Self-Referral

Stitching links anonymous pre-identification events to the identified Referee — essential because the first touch may be anonymous while the conversion is identified. Rules, in priority order:

- **Referral-code-based.** A conversion carrying a `referral_code` links to that code's Referral regardless of session. Handles cross-device/cross-session and payment-provider-metadata (Method B) flows.

- **Click-ID-based.** A `click_id` on the conversion correlates to the originating click event, linking cross-context conversions when no `referral_code` is echoed. Mirrors Product Spec §10 step 2.

- **Session-based.** When a Referee identifies, all prior events in the same `session_id` link to the Referee's `actor_id`. Highest confidence for same-session attribution.

- **Email-based.** `actor_email_hash` links touches (email collected via form) to conversions (email confirmed). Fallback when session and code are insufficient.

- **No probabilistic stitching.** No device-fingerprint, IP-correlation, or behavioral-similarity matching without an explicit shared identifier. A small share of unstitched events is an accepted trade-off for attribution integrity and GDPR compliance.

**Stitching is immutable.** It never modifies existing events — the Referral record is updated with the resolved `referee_id`, and downstream processing operates on that resolved identity. Original events keep their original `actor` state, preserving the audit trail.

**Self-referral detection.** When Participant and Referee are the same person (matching `email`, IP, or device at conversion), the platform raises a `fraud.flagged` with `signal_type: self_referral` and routes to review. It does not modify events.

---

# 8. Versioning & Evolution

The schema must evolve — new conversion types, new AI fields, deprecations — while consumers of historical events keep working and new consumers process old events.

## 8.1 Scope of schema_version

`schema_version` governs the `properties` of a specific `event_type` only. It does not govern the envelope (Section 2.6). Each event type has its own independent lineage: `schema_version: 3` on `payment.completed` is unrelated to `schema_version: 3` on `link.clicked`.

## 8.2 Compatibility & Deprecation

Additive — version unchanged

Add a new optional

properties

field

Add a value to an existing enum

Increase a string's maximum length

Breaking — increment version

Add a new required field

Remove a field

Change a field's type or semantics

Rename a field

On a breaking change the platform keeps producing the old version for a deprecation period of at least six months. Deprecation runs: annotate the field as deprecated → emit the superseding field/type → coexist ≥6 months → stop emitting the old field on new events. Historical events retain deprecated fields permanently (immutability).

## 8.3 Consumer Obligations

- Tolerate unknown fields in `properties` without failure.

- Dispatch deserialization on `event_type` + `schema_version`.

- Handle missing optional fields gracefully.

- Never assume an enum set is closed.

- Handle unknown `event_type` values gracefully (log and skip) — critical for wildcard subscribers like `conversion.*`.

**Tracked vs domain evolution.** The two evolve independently. A change to `payment.completed` (tracked) does not imply a change to `referral.converted` (domain); they are linked by reference (`conversion_event_id`), not by structural inheritance. Domain events may add fields that reference new tracked fields, but always additively.

## 8.4 AI-Readiness

| Design choice | Why it matters for AI |
| --- | --- |
| Flat `properties` (no nested objects) | Trivial feature-vector extraction; no JSON-path flattening in ML pipelines. This is the reason revenue is now flat `revenue_*` fields. |
| Explicit revenue / LTV fields | `revenue_mrr`, `revenue_arr`, `revenue_ltv_estimate` feed incentive optimization directly. |
| Per-event consent | Models respect data-use boundaries at feature-engineering time, not post-hoc. |
| `touch_sequence_number` | Sequence models (LSTM, transformer) for AI-weighted attribution without reconstructing order from timestamps. |
| Fraud-score snapshots on rewards | `fraud_score_at_approval` + later clawbacks yield labeled training data. |
| `detection_layer` on fraud signals | Cost analysis across rule-based, ML-based, and aggregate detection. |

---

**Document status.** Living document. All schemas are working design hypotheses subject to implementation discovery. This v3.0 finalization narrows v2.1 to the ingestion and intra-service surfaces and resolves the nested-revenue and conditional-requirement inconsistencies; no immutable platform constraint is altered.

**Version:** 3.0 · **Date:** June 2026 · **Companion:** Product Specification v4.3 · API Contract v1.3 · Event Model v2.1 (superseded)
