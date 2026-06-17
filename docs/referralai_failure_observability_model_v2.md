# ReferralAI — Failure & Observability Model

## Version 2.0 — Reliability Engineering Specification

> **Classification:** Internal — Architecture  
> **Last Updated:** February 2026  
> **Author:** Reliability Engineering & Platform Architecture  
> **Companion Documents:**  
> - Referral Revenue OS Product Specification v3.2  
> - Public API Contract v1.2  
> - Formal Event Model Specification v2.1  
> - SDK vs Backend Responsibility Contract v2.0  
> **Audience:** SRE, Backend engineers, Support engineering, Fraud ops

---

## Table of Contents

1. [Failure Taxonomy](#1-failure-taxonomy)
2. [Detection Signals](#2-detection-signals)
3. [Client-Facing Monitoring](#3-client-facing-monitoring)
4. [Platform-Side Safeguards](#4-platform-side-safeguards)
5. [Support & Debugging Workflow](#5-support--debugging-workflow)

---

# 1. Failure Taxonomy

Failures are classified by origin layer. Each failure includes what breaks, how silently it breaks, and whether it affects money.

---

## 1.1 SDK Failures

These occur in the browser — hostile territory. The platform assumes every one of these will happen. The RefRev SDK operates exclusively with publishable keys (`rai_pub_`) and is restricted to touch event ingestion and `/v1/sdk/*` endpoints (API Contract Section 2.2).

### F-SDK-01: SDK Not Loaded

**Cause:** Client omitted the snippet, loaded it conditionally and the condition failed, ad blocker or privacy extension blocked the script domain, CSP policy blocks `sdk.refrev.io`.

**What breaks:** Zero touch events. No referral context captured. No cookies set. No widget renders. Attribution falls back entirely to backend-supplied `referral_code` on conversion events — Method A (referee_id matching) or Method B (payment provider metadata) per Product Spec Section 9. If neither is configured, conversions appear organic.

**Money impact:** None directly. Rewards are under-attributed, not over-attributed. The client loses visibility into referral performance but does not pay incorrect rewards.

**Silent failure risk:** High. The client's site works normally. No errors visible to users. The first sign is zero touch events in dashboards, which the client may not check for days or weeks.

### F-SDK-02: `userId` Not Provided in `init()`

**Cause:** Client initializes the SDK without passing `userId` — typically because the developer copied the snippet and did not realize `userId` is mandatory for widget functionality (Product Spec Section 9, Responsibility Contract Section 5.5).

**What breaks:** The widget does not render. Participants never see their referral link, sharing tools, or stats. Self-enrollment for `open` campaigns is impossible via widget. The SDK logs a console warning: `"[RefRev] Widget disabled: userId not provided."` Referee touch tracking (link clicks, cookies) still works for visitors arriving via referral links, but the participant-facing surface is dead.

**Money impact:** Under-attribution indirectly. Participants cannot share links if they cannot see them. The program generates no referral volume unless participants received their links via other channels (enrollment email, magic link portal).

**Silent failure risk:** High. The SDK loads successfully and tracks referee clicks, so the integration health dashboard shows some activity. But the widget never renders, which is only visible if the client checks the "SDK loaded without userId" integration health signal.

### F-SDK-03: Cookie Blocked or Cleared

**Cause:** Browser ITP/ETP policies, user clears cookies, incognito mode, aggressive privacy settings, consent denied.

**What breaks:** The `_rr_ref` cookie (referral code anchor), `_rr_sess` (session identity), and `_rr_vid` (visitor identity) are unavailable. The SDK falls back to localStorage backup for `_rr_ref` attribution data (Responsibility Contract Section 2.4). If localStorage is also unavailable, attribution relies on URL parameter passthrough only. If the visitor navigates away from the landing page and returns directly, the referral context is lost.

**Money impact:** Under-attribution. Conversions that should have been attributed are recorded as organic.

**Silent failure risk:** Medium. The SDK still emits touch events using in-memory session, but they lack the persistent referral context needed for multi-page-load attribution. The localStorage backup mitigates partial cookie loss, but both mechanisms failing together is undetectable until dashboards show decreased attribution coverage.

### F-SDK-04: Consent Unknown / CMP Delay

**Cause:** The client's CMP loads slowly, fails to load, or has a race condition with the SDK. The SDK enters `pending` consent state and queues events in memory (up to 50 events, 30-minute expiry — Product Spec Section 9, Responsibility Contract Section 2.5).

**What breaks:** Touch events are buffered. If the CMP never resolves, events expire after 30 minutes and are dropped. If the visitor navigates away before the CMP resolves, the queue is lost. Unlike `denied` mode (which sends zero events to the platform), `pending` mode is a limbo state where events exist but cannot be transmitted.

**Money impact:** Under-attribution.

**Silent failure risk:** High. The SDK is designed to fail silently — it must never break the client's site. CMP integration failures produce no visible errors and no touch events, with nothing to distinguish "CMP slow" from "no visitors."

### F-SDK-05: Event Submission Failures

**Cause:** Network drops, platform ingestion endpoint temporarily unavailable, rate limit exceeded (10,000 touch events/minute per publishable key — API Contract Section 7.1), DNS resolution failure.

**What breaks:** Touch events are lost or delayed. The SDK retries with exponential backoff. The platform's secondary deduplication (composite key: `referral_code + session_id + 5min_bucket` — API Contract Section 5.4) ensures retried touches are safely deduplicated even if `external_id` generation is unstable.

**Money impact:** Minimal. Touch events are input to attribution but do not move money.

**Silent failure risk:** Medium. The SDK buffers and retries, masking transient failures. Sustained failures produce gaps in touch data visible only in dashboards after the fact.

### F-SDK-06: `sendBeacon` Failure on Page Unload

**Cause:** Browser does not support `sendBeacon`, the browser kills the request before completion, or the payload exceeds the browser's beacon size limit.

**What breaks:** The final event on a page — often the most attribution-significant — is lost.

**Money impact:** Minimal per-event, but aggregated across all visitors this degrades attribution quality.

**Silent failure risk:** High. No callback on `sendBeacon` and no reliable way to know it failed.

### F-SDK-07: `resolve-link` Failure

**Cause:** The `GET /v1/sdk/resolve-link` call (API Contract Section 4.4) fails because of network error, the referral code is invalid or expired, or the campaign is no longer active. The Business Rules Guard returns `410 Gone` for expired links or `422 Unprocessable` for unknown campaigns (API Contract Section 5.7).

**What breaks:** The SDK cannot validate the referral code or retrieve campaign context (cookie TTL, referee reward preview). If the code is invalid, the SDK does not set the `_rr_ref` cookie and does not begin tracking — the visitor's referral context is silently discarded. If the call fails due to a transient network error, the SDK should still persist the raw code from the URL and retry, but the code is unvalidated.

**Money impact:** Under-attribution if legitimate referral codes are discarded due to transient failures.

**Silent failure risk:** High for transient failures. For invalid/expired codes, the behavior is correct (don't track invalid referrals), but the visitor's experience is seamless — they see no error — and the referring participant doesn't know their link is dead.

---

## 1.2 Client Backend Failures

These occur in the client's trusted infrastructure. The platform trusts backend events (`trust_level: high`), which makes backend failures more dangerous. Per the updated auth model (API Contract Section 2), API keys (`rai_live_`) are restricted to event ingestion and SDK endpoints. All CRUD operations require OAuth2 JWT.

### F-BE-01: Conversion Events Never Sent

**Cause:** Client backend team did not implement the integration, deployed a broken build, queued events in a system that failed, or the conversion event endpoint was removed during a refactor. Applies to Method A (referee_id matching) where the backend explicitly sends events. Method B (payment provider metadata) is not affected by this specific failure since conversions arrive via billing webhooks.

**What breaks:** Everything downstream. No conversions → no attribution → no referral state transitions → no reward evaluations → no payouts. The referral program is operationally dead. Touch events continue arriving from the SDK but lead nowhere.

**Money impact:** Under-payout. Participants are not compensated.

**Silent failure risk:** Very high. The platform has no way to know the client *should* be sending conversions. The first signal is a dashboard showing conversion rate of 0%.

### F-BE-02: Referral Code Not Forwarded

**Cause:** The SDK correctly captures the referral code in the `_rr_ref` cookie, but the client's signup/payment flow does not call `RefRev.getAttribution()` and does not include the referral code on the conversion event sent from the backend (Responsibility Contract Section 5.2).

**What breaks:** The highest-fidelity attribution path (direct referral code matching — priority 1 in the stitching order per Event Model Section 6.4) is unavailable. The platform falls back to session-based (priority 2) then email-based (priority 3) stitching. These work when the referee uses the same device and email, but fail for cross-device conversions and email-change scenarios.

**Money impact:** Under-attribution in ambiguous cases. Over-attribution is not possible — the platform does not perform probabilistic stitching.

**Silent failure risk:** High. Attribution still works in many cases via fallback stitching.

### F-BE-03: Revenue Submitted in Wrong Units

**Cause:** Client sends `amount: 49` instead of `amount: 4900` for a €49.00 payment. Their internal systems use major currency units. Per API Contract Section 1.9, all monetary values must be integers in minor units.

**What breaks:** Every financial metric is off by 100x. Revenue per referral, reward ROI, and all KPI dashboards show implausible numbers. Percentage-based rewards calculate on 1/100th of the actual amount.

**Money impact:** Under-payout on percentage rewards.

**Silent failure risk:** Medium. Revenue validation rejects non-integer values (catching `49.00`), but `49` passes because it is a valid integer. The anomaly is visible in dashboards but requires client attention.

### F-BE-04: Duplicate Conversion Events (Non-deterministic `external_id`)

**Cause:** Client generates a random `external_id` on every retry instead of deriving it from a stable domain identifier (`signup:{user_id}`, `payment:{stripe_payment_id}`). Per API Contract Section 1.4, `external_id` is the domain-level deduplication key with a 90-day window.

**What breaks:** Each retry creates a new event. The same conversion counted multiple times. The same reward earned multiple times.

**Money impact:** Over-payout. Participants receive duplicate rewards.

**Silent failure risk:** Medium-low. The platform returns `202 Accepted` with `processing_status: "accepted"` for each unique `external_id`, so the client sees success on every call. Duplicate rewards produce multiple `reward.earned` webhook calls.

### F-BE-05: Events Sent Long After Occurrence

**Cause:** Client batches conversion events and sends them days late, with `occurred_at` set to `new Date()` instead of the actual timestamp. Per Event Model Section 2.1, touch events must have `occurred_at` within 7 days; conversions within 30 days.

**What breaks:** Attribution window evaluation is incorrect.

**Money impact:** Unpredictable — both over- and under-attribution are possible.

**Silent failure risk:** High. Events are accepted as long as `occurred_at` is within the allowed window.

### F-BE-06: Secret Key Leaked

**Cause:** Client commits `rai_live_` key to a public repository, embeds it in frontend code, or logs it in a publicly accessible system.

**What breaks:** An attacker with the secret key can submit fabricated conversion events with `trust_level: high`. However, per the updated auth model (API Contract Section 2.2), the secret key **cannot** approve rewards, initiate payouts, create campaigns, or access any CRUD endpoint — those require OAuth2 JWT. The blast radius is limited to event poisoning.

**Money impact:** Significant but bounded. Fabricated conversions trigger referral workflow transitions, fraud detection, and reward evaluation. If auto-approval is enabled and fraud detection doesn't catch the pattern, fraudulent rewards may be earned and approved. But payout initiation requires OAuth2 JWT, adding a second barrier.

**Silent failure risk:** High until the attack produces visible effects.

### F-BE-07: Using API Keys for CRUD Operations

**Cause:** Client attempts to create campaigns, manage rewards, or read analytics using their `rai_live_` secret key. The developer assumes API keys have broad access (Responsibility Contract Section 5.9).

**What breaks:** Every request returns `403 authorization_error` with the message: "API keys are restricted to event ingestion and SDK endpoints. Use OAuth2 authentication for this resource." No data is read or written.

**Money impact:** None — the operation is cleanly rejected.

**Silent failure risk:** None. The error message is explicit. However, the client may waste integration time before realizing the authentication model.

### F-BE-08: Not Writing Payment Provider Metadata (Method B)

**Cause:** Client configures the Stripe/Paddle/Chargebee webhook integration but forgets to write `refrev_ref_code` into `customer.metadata` at customer creation time (Responsibility Contract Section 5.10).

**What breaks:** The platform receives payment webhooks from the billing provider but cannot attribute them to any referral. Revenue appears in the payment provider's system but not in referral attribution dashboards. Method B is completely broken — it looks like a working integration (webhooks arriving) with zero attribution.

**Money impact:** Under-attribution. Participants are not compensated for legitimate referrals.

**Silent failure risk:** High. The webhook integration is technically "working" — events arrive and are processed. The attribution failure is only visible as "unattributed payments from connected billing provider" in the integration health dashboard.

---

## 1.3 Network Failures

### F-NET-01: SDK-to-Platform Connectivity Loss

**Cause:** DNS failure, regional network partitions, or platform ingestion endpoint unreachable from visitors' geography.

**What breaks:** Touch events buffered in SDK's in-memory queue, then dropped. Attribution degrades proportionally to loss duration. The localStorage backup preserves attribution data (`_rr_ref` contents) across the outage.

**Money impact:** Under-attribution only.

### F-NET-02: Client Backend-to-Platform Connectivity Loss

**Cause:** Client infrastructure cannot reach the ReferralAI API. Firewall rules changed, DNS failure, IP allowlist misconfigured (API Contract Section 7.6).

**What breaks:** Conversion events not delivered. If client retries within 30 days with correct `occurred_at`, events can be backfilled. If not, conversions are lost.

**Money impact:** Under-attribution and under-payout during the outage. Recoverable if retried within the `occurred_at` window.

### F-NET-03: Webhook Delivery Failure

**Cause:** Client's webhook endpoint is down, returns non-2xx, or times out (>30 seconds). Retries: 1min → 5min → 30min → 2h → 12h → 24h, 7 total attempts. 50 consecutive failures → endpoint auto-disabled + notification (API Contract Section 6.5).

**What breaks:** Client does not receive real-time notifications (`referral.converted`, `reward.earned`, `fraud.signal_raised`). If the client's reward approval workflow depends on webhooks in manual-approval mode, rewards sit in `Pending` status indefinitely.

**Money impact:** Delayed payouts for manual-approval campaigns.

**Silent failure risk:** Medium. Auto-disable notification fires after 50 failures.

### F-NET-04: Billing Provider Webhook Failure (Method B)

**Cause:** The Stripe/Paddle/Chargebee webhook to the platform's integration endpoint fails — the billing provider cannot reach the platform, or the platform's webhook handler is degraded.

**What breaks:** Method B attribution is completely stalled. Payment events from the billing provider are not processed. Conversions are not recorded. Referral workflows do not advance.

**Money impact:** Under-attribution for all clients using Method B during the outage. Unlike F-NET-02, the client cannot retry because they did not originate the event — the billing provider did.

**Silent failure risk:** Medium. The billing provider's webhook delivery dashboard shows failures. The platform's integration health dashboard shows "billing webhook last received" timestamp going stale. But the client may not monitor either.

---

## 1.4 Platform Ingestion Failures

### F-ING-01: Ingestion Pipeline Backpressure

**Cause:** Traffic spike, SQS/SNS consumer lag, downstream service (Redis, PostgreSQL) degraded.

**What breaks:** Events accepted (`202 Accepted`) but processing delayed. `ingested_at` and `processed_at` diverge. `processing_status` stays at `accepted` instead of transitioning to `processed`. Attribution, reward evaluation, fraud checks, and webhook delivery delayed.

**Money impact:** Delayed payouts. No incorrect attribution — processing is eventually consistent.

### F-ING-02: Business Rules Guard Rejections

**Cause:** The Business Rules Guard (API Contract Section 5.7) rejects events that pass schema validation but fail campaign-level business rules. Expired referral links → `410 Gone`. Paused campaigns → touch events accepted but conversions rejected. Unknown campaign IDs → `422 Unprocessable`.

**What breaks:** For legitimate expired links, this is correct behavior. For legitimate events hitting a paused campaign or a recently-ended campaign, the rejection may surprise the client.

**Money impact:** Under-attribution if the client's timing is off (conversion arrives after campaign ends).

**Silent failure risk:** Low. The HTTP response codes (410, 422) are explicit. But clients that don't check response codes may not notice.

### F-ING-03: Deduplication False Positive

**Cause:** Two genuinely distinct events share the same `tenant_id + external_id` because the client reused an `external_id` across event types or the 90-day window overlaps with a legitimate second occurrence.

**What breaks:** A real event is silently discarded as a duplicate. The platform returns `200 OK` with `processing_status: "duplicate"`.

**Money impact:** Under-attribution if the deduplicated event was a conversion.

**Silent failure risk:** Very high. The `duplicate` response looks identical to correct deduplication.

### F-ING-04: ClickHouse Analytics Lag or Failure

**Cause:** ClickHouse cluster degradation, replication lag, or query saturation.

**What breaks:** Dashboard KPIs are stale or unavailable. The transactional pipeline (PostgreSQL + Temporal + Redis) continues processing unaffected.

**Money impact:** None directly — ClickHouse is a read path.

---

## 1.5 Attribution Logic Failures

### F-ATT-01: Identity Stitching Failure

**Cause:** The conversion event lacks `referral_code` (bypassing priority-1 referral-code-based stitching), the `session_id` doesn't match any touch events (bypassing priority-2 session-based stitching), and the `actor_email_hash` doesn't match (bypassing priority-3 email-based stitching). Per Event Model Section 6.4, probabilistic stitching is explicitly not performed.

**What breaks:** Conversion recorded as organic. Participant who drove the conversion receives no credit.

**Money impact:** Under-payout.

**Silent failure risk:** High. The platform records the conversion correctly — it just cannot attribute it. The "unattributed conversion" counter increments.

### F-ATT-02: Attribution Window Misconfiguration

**Cause:** Client sets a 7-day attribution window for a product with a 30-day sales cycle. Campaign-level `attribution_window_days` (API Contract Section 3.2) overrides the program default.

**What breaks:** Conversions that are causally linked to referrals fall outside the window and are recorded as organic.

**Money impact:** Under-payout.

### F-ATT-03: Multi-Touch Attribution Disputes

**Cause:** Multiple participants touched the same referee. First-touch and last-touch models assign 100% credit to different participants.

**What breaks:** Trust in the attribution model. Surfaces as support tickets.

**Money impact:** Correct by the selected model's definition, but disputed by the non-credited participant.

### F-ATT-04: Temporal Workflow Failure

**Cause:** Temporal worker crashes, workflow execution times out, or determinism violation causes a replay failure.

**What breaks:** Referral state transitions stall. A referral that should move from `Qualified` to `Converted` is stuck. Reward evaluation, fraud checks, and fulfillment do not execute.

**Money impact:** Delayed payouts. If permanently stuck, manual intervention required.

### F-ATT-05: Variant Resolution Failure at Enrollment

**Cause:** Per Product Spec Section 5, variant resolution happens at participant enrollment time using a priority-based fallback chain. If no variant's segment matches the participant and no Default Variant is configured, variant resolution fails. This should not happen because every campaign has a Default Variant (Product Spec Section 2), but data inconsistency or a race condition during campaign setup could cause it.

**What breaks:** Participant enrollment fails or the participant receives no link. The `POST /v1/sdk/enroll` call (for open campaigns) or `POST /v1/referrers` call (proactive enrollment) returns an error.

**Money impact:** None — no referral link is generated, so no referral activity occurs.

**Silent failure risk:** Low. The enrollment API returns an error. But if the client doesn't check enrollment responses, participants may silently fail to receive links.

---

# 2. Detection Signals

---

## 2.1 Metrics That Matter

### Ingestion Layer

| Metric | Source | Normal Range | Anomaly Indicates |
|--------|--------|-------------|-------------------|
| `events.ingested.rate` (by `event_class`, `event_type`, tenant) | Event Ingestion Service | Stable ±20% WoW | F-BE-01 (conversion drop to zero), F-NET-02 (all-event drop), F-SDK-01 (touch drop) |
| `events.rejected.rate` (by error_code, tenant) | API gateway | < 2% of ingested | F-ING-02 (Business Rules Guard spike: 410/422), F-BE-03 (schema violations) |
| `events.deduplicated.rate` (by tenant) | Deduplication service | < 5% of ingested | F-BE-04 (spike = non-deterministic `external_id`) |
| `events.processing_status.distribution` (by tenant) | Event pipeline | > 95% reach `processed` within 60s | F-ING-01 (backpressure: events stuck at `accepted`) |
| `events.ingestion_latency_p99` | Event Ingestion Service | < 200ms | F-ING-01 |
| `events.processing_latency_p99` | Event pipeline | < 5s | F-ING-01, F-ATT-04 (Temporal lag) |
| `events.business_rules_guard.rejection_rate` (by code: 410/422) | Ingestion Service | < 1% | F-ING-02 (spike = expired links circulating or campaign misconfigured) |

### Attribution Layer

| Metric | Source | Normal Range | Anomaly Indicates |
|--------|--------|-------------|-------------------|
| `attribution.coverage_pct` (per tenant) | Attribution Engine | > 80% | F-BE-02 (no referral code), F-SDK-03 (cookies blocked), F-ATT-01 (stitching failure) |
| `attribution.unstitched_conversions.rate` | Identity Service | < 15% | F-ATT-01, F-BE-02 |
| `attribution.window_expired.rate` (per campaign) | Attribution Engine | < 10% | F-ATT-02 (window misconfigured), F-BE-05 (late events) |
| `attribution.method_b.unattributed_payments.rate` | Integration Service | 0% if Method B fully configured | F-BE-08 (metadata not written to payment provider) |
| `attribution.stitching_method.distribution` (per tenant) | Attribution Engine | Referral-code-based > 70% | F-BE-02 (low code-based = code not being forwarded, falling back to weaker methods) |

### Reward Layer

| Metric | Source | Normal Range | Anomaly Indicates |
|--------|--------|-------------|-------------------|
| `rewards.earned.rate` (per campaign) | Reward Evaluator | Proportional to conversion rate | Spike = F-BE-04 (duplicate conversions), Drop = F-BE-01 (no conversions) |
| `rewards.pending.age_p95` | Reward Service | < 48h (manual approval), instant (auto) | F-NET-03 (webhook failure → client not receiving approval requests) |
| `rewards.paid_to_approved_ratio` | Reward Service | > 90% | Fulfillment or payout processing failure |
| `rewards.reversed.rate` (per campaign) | Reward Service | < 3% | Fraud spike, or client integration error producing phantom conversions |

### SDK Health (Client-Side Telemetry)

| Metric | Source | Normal Range | Anomaly Indicates |
|--------|--------|-------------|-------------------|
| `sdk.load_success.rate` (per tenant) | SDK beacon / server logs | > 95% | F-SDK-01 (ad blockers, CSP, snippet missing) |
| `sdk.init_without_userid.rate` (per tenant) | SDK console warning counter (sent as metadata) | 0% | F-SDK-02 (widget disabled, participant surface dead) |
| `sdk.events_dropped.count` (per session) | SDK internal counter | 0 | F-SDK-05 (sustained network failure) |
| `sdk.consent_pending_timeout.count` | SDK internal | 0 | F-SDK-04 (CMP not responding, 30-min queue expiry) |
| `sdk.cookie_available.rate` | SDK beacon | > 80% (varies by region) | F-SDK-03 (ITP, consent denied, incognito) |
| `sdk.localstorage_fallback.rate` | SDK beacon | Low, > 0 only when cookies fail | F-SDK-03 (cookies failing, localStorage compensating) |
| `sdk.resolve_link.failure_rate` | SDK / API gateway | < 1% | F-SDK-07 (network or validation failures) |
| `sdk.resolve_link.expired_code.rate` | SDK / API gateway (410 responses) | Near 0% | Participants sharing dead links |

### Webhook Delivery

| Metric | Source | Normal Range | Anomaly Indicates |
|--------|--------|-------------|-------------------|
| `webhooks.delivery_success.rate` (per endpoint) | Webhook Service | > 99% | F-NET-03 |
| `webhooks.consecutive_failures.count` (per endpoint) | Webhook Service | 0 | Approaching auto-disable (50) |
| `billing_webhooks.last_received_at` (per integration) | Integration Service | Within expected billing cycle frequency | F-NET-04 (billing provider webhook failure) |

### Infrastructure

| Metric | Source | Normal Range | Anomaly Indicates |
|--------|--------|-------------|-------------------|
| `temporal.workflow_stuck.count` | Temporal visibility | 0 | F-ATT-04 |
| `temporal.task_queue_backlog` | Temporal metrics | < 100 pending | Processing bottleneck |
| `clickhouse.replication_lag` | ClickHouse cluster | < 10s | F-ING-04 |
| `sqs.message_age_p99` | AWS SQS metrics | < 30s | F-ING-01 (consumer backpressure) |
| `rds.connection_pool_utilization` | PostgreSQL | < 80% | Approaching saturation |

---

## 2.2 Anomaly Patterns

**Pattern: "Touch Events Arriving, Zero Conversions"**
- `events.ingested.rate` for tracked touch events is normal
- `events.ingested.rate` for tracked conversion events is zero for the tenant
- Diagnosis: F-BE-01 (backend not sending conversions). Not a platform problem. Contact client.

**Pattern: "Conversions Arriving, Low Attribution"**
- Conversion events normal
- `attribution.coverage_pct` below 60%
- `attribution.stitching_method.distribution` shows low referral-code-based stitching
- Diagnosis: F-BE-02 (referral code not forwarded). The client is not calling `RefRev.getAttribution()` or not passing the code through their backend.

**Pattern: "Billing Webhooks Arriving, Zero Attribution" (Method B)**
- `billing_webhooks.last_received_at` is recent
- `attribution.method_b.unattributed_payments.rate` is 100%
- Diagnosis: F-BE-08 (payment provider metadata not written). The Stripe/Paddle/Chargebee webhook integration is receiving events, but no customer has `refrev_ref_code` in their metadata.

**Pattern: "SDK Loaded, Widget Never Rendered"**
- `sdk.load_success.rate` is normal
- `sdk.init_without_userid.rate` is elevated or 100%
- Diagnosis: F-SDK-02 (userId not provided). The SDK is tracking referee clicks but participants cannot see or use the widget.

**Pattern: "Revenue Per Referral is Implausibly Low"**
- Average `revenue.amount` on `conversion.payment_completed` events is 100x lower than expected
- Diagnosis: F-BE-03 (major units instead of minor). Confirm by checking if revenue values are non-integer when divided by 100.

**Pattern: "Duplicate Rewards Earned"**
- `events.deduplicated.rate` is normal (0%)
- `rewards.earned.rate` is elevated
- Multiple `reward.earned` domain events for the same referee within minutes
- Diagnosis: F-BE-04 (non-deterministic `external_id`). Deduplication is working correctly — it just cannot detect what the client didn't mark as a duplicate.

**Pattern: "High Business Rules Guard Rejections"**
- `events.business_rules_guard.rejection_rate` spikes
- 410s dominate → expired referral links circulating
- 422s dominate → events referencing unknown campaigns
- Diagnosis: F-ING-02. Check if a campaign recently ended or if the client's integration is referencing stale campaign IDs.

---

## 2.3 Silent Failures

| Silent Failure | Why It's Silent | How It Eventually Surfaces |
|----------------|----------------|---------------------------|
| SDK not deployed on all pages | Platform only sees events from pages where SDK is loaded | Attribution coverage drops; client reports "referrals not tracked on pricing page" |
| Consent denied at high rates | In `denied` mode, zero events sent to platform (Responsibility Contract Section 2.5). Indistinguishable from "no visitors." | Attribution coverage low. Backend conversion events have no matching touches. Region-specific analysis required. |
| Client backend silently dropping events | Events disappear before reaching platform | Client's own conversion count exceeds platform's. Client must compare. |
| Referral code stripped by intermediary | URL shorteners, some email clients, in-app browsers strip `?ref=` parameter | Attribution falls back to email/session matching. `_rr_ref` cookie never set. |
| Clock skew on client backend | `occurred_at` inaccurate but within allowed range | Intermittent attribution failures near window boundaries |
| Method B metadata never written | Webhook integration "works" — events arrive — but no attribution possible | "Unattributed payments from billing provider" warning in integration health dashboard |

---

# 3. Client-Facing Monitoring

---

## 3.1 Integration Health Dashboard

The platform exposes an **Integration Health** view in the client dashboard (requires OAuth2 JWT — this is a dashboard feature, not an API endpoint).

### Health Indicators

| Indicator | Status Logic | What the Client Sees |
|-----------|-------------|---------------------|
| **SDK Status** | Green: touch events in last 1h. Yellow: in last 24h but not 1h. Red: none in 24h. | "SDK is active" / "SDK may be offline — no touch events in {N} hours" |
| **SDK Widget Status** | Green: > 80% of SDK loads include `userId`. Yellow: 50-80%. Red: < 50%. | "Widget rendering normally" / "Warning: SDK loaded {N} times without userId — widget disabled for those sessions" |
| **Backend Event Delivery** | Green: conversion events in last 24h. Yellow: in last 7d but not 24h. Red: none in 7d. Gray: never received. | "Conversion events being received" / "Last conversion event was {N} days ago" |
| **Attribution Coverage** | Green: > 80%. Yellow: 50-80%. Red: < 50%. | Percentage + trend + tooltip explaining how to improve |
| **Referral Code Presence** | Percentage of conversion events that include `referral_code`. Green: > 70%. Yellow: 30-70%. Red: < 30%. | "X% of conversion events include a referral code" |
| **Billing Integration (Method B)** | Green: attributed payments in last 24h. Yellow: webhooks received but no attribution. Red: no webhooks in 7d. Gray: no billing integration configured. | "Stripe payments being attributed" / "Warning: receiving Stripe webhooks but no payments have referral metadata" |
| **Webhook Health** | Per-endpoint: Green (< 5% failure), Yellow (5-20%), Red (> 20% or disabled). | Endpoint URL + status + last successful delivery timestamp |
| **Revenue Validation** | Green: no anomalies. Yellow: average revenue per referral < €1. Red: values suggest major/minor unit confusion. | "Revenue values look correct" / "Warning: average revenue is €0.47 — did you mean €47.00?" |

### Event Timeline

Real-time (1-minute resolution) timeline showing:
- Touch events per minute (by `event_type` subtype: `touch.link_clicked`, `touch.link_shared`, etc.)
- Conversion events per minute (by `event_type`)
- Rejected events per minute (by HTTP status code: 400, 403, 410, 422)
- Domain events per minute (referral state transitions)
- Webhook deliveries per minute (by endpoint and status)

Filterable by campaign, variant, and time range.

---

## 3.2 Warnings & Alerts

| Alert | Trigger Condition | Severity | Delivery |
|-------|-------------------|----------|----------|
| **No touch events** | Zero touch events for tenant in 6h (previously active) | Critical | Dashboard + email |
| **No conversion events** | Zero conversions for tenant in 48h (previously active) | Critical | Dashboard + email |
| **Widget not rendering** | > 50% of SDK loads without `userId` over 24h | Warning | Dashboard |
| **Attribution coverage drop** | Attribution coverage drops > 20pp in 7 days | Warning | Dashboard |
| **Referral code presence drop** | Code presence on conversions drops > 30pp in 7 days | Warning | Dashboard |
| **Revenue anomaly** | Average revenue per referral deviates > 50x from 30-day average | Warning | Dashboard + email |
| **Unattributed billing payments** | Billing integration active, > 10 payments received without referral metadata in 7 days | Warning | Dashboard |
| **Webhook endpoint disabled** | Endpoint auto-disabled (50 consecutive failures) | Critical | Email |
| **Webhook endpoint degraded** | Success rate < 80% over 1h | Warning | Dashboard |
| **High deduplication rate** | Dedup rate > 20% over 1h | Warning | Dashboard |
| **Reward approval backlog** | Manual-approval rewards in `Pending` > 7 days | Warning | Dashboard + email |
| **Fraud rate spike** | Fraud signals > 8% of referrals over 24h for a campaign | Critical | Dashboard + email |
| **Expired links circulating** | > 100 `410 Gone` responses for resolve-link in 24h for a campaign | Warning | Dashboard |
| **API key nearing rate limit** | Key used > 80% of rate limit budget | Info | Dashboard |
| **SDK version outdated** | SDK version > 6 months old | Info | Dashboard |

Alert suppression: no alerts for never-active tenants. Rate-limited to 1 email per alert type per 24h. Dashboard alerts always visible.

---

## 3.3 Attribution Confidence Indicators

Each attributed referral includes a **confidence level**:

| Confidence | Criteria | Display |
|------------|----------|---------|
| **High** | Direct `referral_code` match (stitching priority 1). Single participant in chain. Conversion within first 50% of window. | Green badge. |
| **Medium** | Session-based or email-based stitching (priorities 2-3). OR: Multiple participants touched referee. OR: Conversion in last 25% of window. | Yellow badge + method used. |
| **Low** | Email-hash stitching only. OR: Edge-of-window. OR: Attribution computed via replay. | Orange badge + note that referral code was absent. |

---

# 4. Platform-Side Safeguards

---

## 4.1 Dead-Letter Queues

Every processing stage has a DLQ for events failing after retry exhaustion.

```
Tracked event ingested → SNS/SQS → Consumer service
                                       │
                                  ┌────┴────┐
                             Success     Failure (after 3 retries)
                                  │            │
                                  ▼            ▼
                             Continue      DLQ (per service)
                                           │
                                      ┌────┴────┐
                                 Inspect     Alert (depth > threshold)
```

### DLQ Per Service

| Service | DLQ Name | Alert Threshold | Typical Contents |
|---------|----------|-----------------|------------------|
| Event Ingestion | `dlq-event-ingestion` | > 10 / 5 min | Tracked events passing HTTP validation but failing internal processing |
| Workflow Runtime | `dlq-workflow-runtime` | > 5 / 5 min | Domain events that failed to trigger or advance referral workflows |
| Attribution Engine | `dlq-attribution` | > 5 / 5 min | Conversion events causing unhandled exceptions during attribution |
| Reward Evaluator | `dlq-reward-eval` | > 5 / 5 min | Attribution results failing reward evaluation |
| Fraud Detector | `dlq-fraud` | > 5 / 5 min | Events causing fraud scoring errors. Non-blocking: events proceed to attribution even if fraud scoring fails. |
| Webhook Dispatcher | `dlq-webhooks` | > 50 / 1 hour | Payloads that failed all 7 delivery attempts (terminal failures) |
| Integration Service | `dlq-integrations` | > 5 / 5 min | Billing provider webhook payloads (Method B) that failed processing |

### DLQ Rules

- Never auto-replayed. Engineer must inspect, diagnose, decide.
- Full event envelope retained with error metadata (message, stack trace, retry count).
- Retained 14 days, then archived to S3 for the tenant's retention period.
- Depth > threshold → P2 on-call incident. Depth > 100 → P1.

---

## 4.2 Replay Mechanisms

### Replay Types

**Event Replay (by time range + tenant):** Reprocesses tracked events from immutable event store (S3 + PostgreSQL). Idempotent via `event_id` deduplication in consumers.

**Event Replay (by event_id list):** Specific events, typically from DLQ investigation. Small batches (< 1000).

**Attribution Replay (per campaign):** Recomputes attribution for all conversions in a campaign. Does not re-ingest events — re-evaluates attribution logic on existing event set. Rewards already in `Paid` state are not automatically reversed; client must initiate reversals if needed.

**Derived Event Rebuild:** Regenerates all domain events from base tracked events. Used after significant bugs or new AI model deployment.

### Replay Safeguards

- Initiated by platform engineers only, never clients.
- Logged in audit trail with engineer identity, time range, and reason.
- Rate-limited. > 100,000 events requires two-engineer approval.
- Attribution replays affecting rewards generate a "rewards that would change" report before any state modification. Engineer approval required.

---

## 4.3 Reconciliation Jobs

| Job | Schedule | What It Checks | Action on Failure |
|-----|----------|----------------|-------------------|
| **Conversion-to-Attribution** | Every 6h | Every tracked conversion event in the last 24h has a corresponding attribution result or explicit "unattributable" marker | Flags orphaned conversions. Triggers replay. |
| **Reward-to-Referral** | Daily | Every referral in `Converted` state has at least one `reward.earned` domain event (unless campaign has no reward). Every reward in `Paid` state has a payout record. | Flags referrals with missing rewards. Flags rewards with missing payouts. |
| **Event Count Reconciliation** | Daily | Event count in PostgreSQL matches ClickHouse within 0.1% tolerance | Flags replication gaps. Triggers ClickHouse backfill. |
| **Webhook Delivery** | Every 12h | Every webhook-eligible domain event in the last 48h has a delivery record per subscribed endpoint | Flags undelivered events (routing bug in dispatcher). |
| **Revenue Sanity** | Daily | Average revenue per conversion per tenant within 2 SD of 30-day average | Flags revenue anomalies (unit error, price change, integration bug). |
| **Fraud Score Coverage** | Daily | Every referral created in last 24h has a fraud score | Flags referrals that bypassed fraud scoring. |
| **Billing Webhook Attribution** | Daily | For tenants with billing integrations (Method B): ratio of payment webhooks received to attributed conversions | Flags billing integrations where payments arrive but attribution never completes (F-BE-08). |
| **Enrollment-to-Link** | Daily | Every participant in `Active` state has at least one referral link generated | Flags participants who were enrolled but never received a link (F-ATT-05). |

---

## 4.4 Fraud-Safe Degradation

When a component fails, the system prevents fraudulent payouts at the cost of delayed legitimate payouts.

| Component Down | Degradation Behavior | Rationale |
|----------------|---------------------|-----------|
| **Fraud detection** | All rewards shift to `Pending` regardless of `approval_mode`. Auto-approval suspended. Per Trust Model (Product Spec Section 7), even Advocate-level participants are subject to manual review. | Without fraud scoring, auto-approving is unsafe. |
| **Attribution Engine** | Conversion events queued but not attributed. Referral state transitions halt. No rewards earned. | Under-paying during outage is safer than mis-attributing. Events replayed on recovery. |
| **Reward Evaluator** | Attribution completes, but reward evaluation deferred. Referrals transition to `Converted` but `reward.earned` domain event not emitted. | Rewards calculated after recovery. |
| **Temporal (Workflow Runtime)** | Referral workflows pause. New referrals created but do not advance. Domain events queue. | Temporal is the state machine. Without it, workflows cannot safely advance. |
| **ClickHouse** | Dashboards stale. Transactional pipeline continues normally. | Analytics are read-only. |
| **Redis** | Ingestion latency increases (cache misses fall through to PostgreSQL). Rate limiting becomes approximate. | System slows but does not stop. |
| **Integration Service (Method B)** | Billing webhooks are buffered. No Method B attribution until recovery. Method A continues normally. | Billing provider retries webhook delivery. Events processed on recovery. |

### Payout Freeze

If more than one critical service is degraded simultaneously (fraud detection + reward evaluator, or attribution engine + Temporal), the platform freezes all payout processing for affected tenants:
- Rewards in `Paid` state: not reversed.
- Rewards in `Approved` state: do not proceed to `Processing`.
- Rewards in `Pending` state: do not proceed to `Approved`.

Freeze lifts automatically when all critical services are healthy and a reconciliation job confirms consistency.

---

# 5. Support & Debugging Workflow

---

## 5.1 Investigation Flow

### Tier 1: Integration Health Check (< 5 minutes)

1. Open the client's Integration Health Dashboard (Section 3.1).
2. Check all health indicators. Red/Yellow indicators explain the likely cause.
3. Check the Event Timeline for the period around the reported issue.
4. Check the Alerts tab.

Most integration issues are diagnosable from the dashboard alone.

### Tier 2: Event Trace (< 15 minutes)

Trace a specific referral, conversion, or reward:

1. Identify the entity: `referral_id`, `reward_id`, `external_id`, or referee email.
2. Query the Event Log (filtered by `referral_id`, `external_id`, or actor email hash) — requires `processing_status` filter to distinguish `accepted`/`processed`/`failed`/`duplicate`.
3. Reconstruct the event sequence:
   - Which tracked touch events exist? What `session_id`, `referral_code`, `anonymous_id`?
   - Which tracked conversion event(s) exist? `referral_code` present? `occurred_at` timestamp?
   - What `event_class: domain` events were produced? What attribution result? What stitching method?
   - What reward lifecycle domain events exist? (`reward.earned` → `reward.approved` → `reward.paid`)
   - What fraud signals were raised (if any)? What `detection_layer` (rule-based, ML, LLM)?
4. Full correlation chain: `external_id` → `event_id` → `referral_id` → `attribution_context` → `reward_id` → `payout_id`.

### Tier 3: Platform-Side Investigation (< 1 hour)

1. Check DLQ depths per service.
2. Check Temporal workflow visibility for the referral's execution.
3. Check reconciliation job outputs.
4. Check Grafana dashboards for infrastructure anomalies (SQS backlog, ClickHouse lag, RDS pool).

### Escalation Criteria

| Condition | Escalation |
|-----------|------------|
| DLQ contains events for the tenant | On-call engineer (P2) |
| Temporal workflow stuck | Platform engineering (P2) |
| Revenue reconciliation failure | Finance ops + platform engineering (P1) |
| Suspected fraud that bypassed detection | Fraud ops (P1) |
| Data loss (events accepted but not found in store) | Platform engineering (P0) |
| Billing integration webhook processing failure | Integration engineering (P2) |

---

## 5.2 Inspectable Data

### Client-Accessible

| Data | Access Path | Detail Level |
|------|------------|-------------|
| Tracked touch events | Dashboard event log, API `GET /v1/events?event_class=tracked&type=touch` (OAuth2 JWT) | Full envelope except raw IP (only `ip_hash` and `country`). |
| Tracked conversion events | Dashboard event log, API `GET /v1/events?event_class=tracked&type=conversion` (OAuth2 JWT) | Full envelope. Revenue visible. `external_id` visible. |
| Domain events (referral lifecycle) | Dashboard referral detail, API `GET /v1/referrals/{id}` with `expand=events` (OAuth2 JWT) | State transitions, attribution, reward lifecycle. |
| Attribution results | Dashboard referral detail, API `GET /v1/referrals/{id}` with `expand=attribution` | Model used, confidence level, stitching method, touch chain, contributing participants. |
| Reward lifecycle | Dashboard reward detail, API `GET /v1/rewards/{id}` | Full lifecycle: `Pending` → `Approved`/`Rejected` → `Processing` → `Paid`/`Reversed`. |
| Fraud signals | Dashboard referral detail (when flagged), API `GET /v1/referrals/{id}` with `expand=fraud_signals` | Signal types, fraud score, `detection_layer` (rule/ML/LLM). |
| Webhook delivery logs | Dashboard webhook management | Per-event: status, HTTP response code, retry count, timestamp. |
| Integration health | Dashboard integration tab | All indicators from Section 3.1. |
| Participant trust scores | Dashboard participant detail | Trust score (0-100), trust level (New/Established/Trusted/Advocate), component breakdown. |

### Client NOT Accessible (Intentionally Opaque)

| Data | Why Hidden |
|------|-----------|
| Raw IP addresses | Only `ip_hash` + geo. GDPR. |
| Other tenants' data | Absolute tenant isolation. |
| Fraud detection model internals | Exposing features/weights/thresholds allows gaming. Only signal types, scores, and detection layers visible. |
| Platform infrastructure state | DLQs, Temporal internals, ClickHouse health. Clients see effects, not causes. |
| Audit logs via API | Dashboard-only (API Contract Section 7.7). Prevents programmatic access that could cover tracks. |
| Full API key values | Last four characters only, everywhere. |
| Internal routing metadata | Queue assignments, worker identity, processing duration. |

### Support-Accessible (Internal Only)

| Data | Access Path | Use Case |
|------|------------|----------|
| Full event pipeline trace | Grafana + Loki (OpenTelemetry) | Processing failures, latency investigations |
| DLQ contents | AWS console / internal tooling | Why specific events failed processing |
| Temporal workflow execution | Temporal Web UI | Stuck referral workflows |
| Reconciliation job outputs | Internal ops dashboard | Systemic inconsistencies |
| Rate limit utilization per key | Internal API management | Diagnosing 429 errors |
| ClickHouse query logs | Internal monitoring | Dashboard staleness |
| Billing provider webhook raw payloads | Integration Service logs | Method B debugging |

---

## 5.3 Debugging Correlation Keys

```
external_id (client-provided)
    → event_id (platform-assigned, ULID)
        → referral_id (workflow instance)
            → attribution_context.campaign_id
            → attribution_context.variant_id
            → attribution_context.participant_id
                → reward_id (if converted)
                    → payout_id (if paid)
```

Additional correlation:
- `session_id` (from `_rr_sess` cookie) links all touches within a browser session
- `anonymous_id` (from `_rr_vid` cookie) links touches across sessions (with consent)
- `actor_email_hash` links events across devices (fallback)
- `api_key_prefix` (last four chars) identifies which key sent the event
- `sdk_version` identifies the SDK build
- `click_id` links a specific link click to subsequent events
- `integration_id` identifies which billing integration produced a Method B event

### Debugging Checklists

**"Participant says they referred someone but got no reward"**

1. Find `participant_id`. Search for touch events where `attribution_context.participant_id` matches.
2. Confirm touch events exist for the claimed referee (by session/email).
3. Check if a tracked conversion event exists for the referee. If no → F-BE-01 or referee didn't convert.
4. If conversion exists, check `referral_code` presence. If absent → stitching relied on fallback.
5. Check attribution result. Was a different participant credited? (F-ATT-03)
6. Check if referral expired (F-ATT-02, window exceeded).
7. Check fraud signals. Was the referral flagged or auto-blocked?
8. Check reward lifecycle: `Pending`? `Approved`? Stuck due to F-NET-03 (webhook failure)?
9. Check participant trust level. Is the participant in `Flagged` or `Suspended` state? (Product Spec Section 7 — rewards are `Held` for flagged/suspended participants.)

**"Dashboard shows zero conversions but we have real sign-ups"**

1. Check Integration Health → Backend Event Delivery indicator.
2. If Red/Gray → F-BE-01. Client not sending conversions.
3. If Method B configured → check Billing Integration indicator. Yellow (webhooks but no attribution) → F-BE-08.
4. If Green → events exist but attribution failing. Check attribution coverage.
5. If events exist and attribution normal → check ClickHouse lag (F-ING-04, stale dashboard).

**"Widget not showing for our users"**

1. Check Integration Health → SDK Widget Status indicator.
2. If Red → F-SDK-02. `userId` not provided in `RefRev.init()`.
3. If `userId` is provided → check enrollment status. Is the user enrolled as a participant?
4. If campaign is `selective` and user not pre-enrolled → widget is intentionally hidden (correct behavior).
5. If user is enrolled but widget still hidden → check participant state. `Suspended`/`Banned` → widget hidden (correct behavior, Product Spec Section 7).

---

> **Document Status:** Living document. All failure modes and signals are based on the system design in Product Spec v3.2, API Contract v1.2, Event Model v2.1, and Responsibility Contract v2.0. Thresholds and alert configurations will be calibrated during implementation.  
> **Version:** 2.0  
> **Date:** February 2026  
>  
> **Changes from v1.0:**  
> - Terminology: "Referrer" → "Participant" throughout (aligned with Product Spec v3.2)  
> - Identifiers: UUID v7 → ULID (aligned with API Contract v1.2)  
> - Auth model: Reflected 3-tier authentication (API keys restricted to ingestion + SDK, OAuth2 JWT for CRUD). Added F-BE-07.  
> - SDK: Added F-SDK-02 (userId not provided), F-SDK-07 (resolve-link failure). Updated cookie names (_rr_*). Updated consent denied behavior (zero events, not anonymous events). Noted localStorage backup. Updated buffer specs (50 events, 30 min).  
> - Attribution: Added Method B (payment provider metadata) failures (F-BE-08, F-NET-04). Updated stitching priority order (code → session → email). Added F-ATT-05 (variant resolution at enrollment).  
> - Ingestion: Added F-ING-02 (Business Rules Guard: 410/422). Updated to 202 Accepted async processing. Added processing_status monitoring.  
> - Reward states: Updated to Pending → Approved → Processing → Paid | Rejected | Reversed  
> - Trust model: Integrated participant trust levels (New/Established/Trusted/Advocate) into debugging checklists  
> - Detection signals: Added SDK widget health, Method B attribution, stitching method distribution, Business Rules Guard rejection metrics  
> - Client-facing: Added Widget Status indicator, Billing Integration indicator, expired links alert  
> - Reconciliation: Added Billing Webhook Attribution job, Enrollment-to-Link job  
> - Safeguards: Added Integration Service DLQ and degradation behavior  
> - Debugging: Added Method B debugging, widget not showing checklist, updated correlation keys (ULID, click_id, integration_id)  
> - Companion document references updated to v3.2, v1.2, v2.1, v2.0
