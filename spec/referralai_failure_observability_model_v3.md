# ReferralAI — Failure & Observability Model

## Version 3.0 — Reliability Engineering Specification

> **Classification:** Internal — Architecture
> **Last Updated:** June 2026
> **Author:** Reliability Engineering & Platform Architecture
> **Companion Documents:**
> - Referral Revenue OS Product Specification v4.0
> - Public API Contract v1.3
> - Formal Event Model Specification v3.0
> - SDK vs Backend Responsibility Contract v2.0
> **Audience:** SRE, Backend engineers, Support engineering, Fraud ops

---

## Table of Contents

1. [Failure Taxonomy](#1-failure-taxonomy)
2. [Detection Signals](#2-detection-signals)
3. [Client-Facing Monitoring](#3-client-facing-monitoring)
4. [Platform-Side Safeguards](#4-platform-side-safeguards)
5. [Support & Debugging Workflow](#5-support--debugging-workflow)

This revision reconciles the model against the current companion specifications (Product Spec v4.0, API Contract v1.3, Event Model v3.0). The structure, failure-ID scheme, and core stance are unchanged. The substantive deltas — flattened revenue fields and the conditional MRR/identity requirements, the corrected Ingestion Event Rules Guard behaviour for paused campaigns, the first-class Program Health Score, per-checkpoint fraud thresholds, and the fraud/trust communication effects — are folded into the relevant sections and summarized in the change log at the end.

Two correctness principles govern everything below and resolve every ambiguous case:

1. **Under-attribute and under-pay before mis-attributing or over-paying.** When data quality or fraud risk is uncertain, the system withholds credit and money rather than guessing.
2. **Benign data loss must never trigger punitive action.** A dropped beacon or a blocked cookie degrades coverage; it must never be read as fraud and must never suspend a participant or claw back a reward.

---

# 1. Failure Taxonomy

Failures are classified by origin layer. Each failure records what breaks, how silently it breaks, and whether it can move money. For every class, the dominant effect is one of three: it reduces **coverage** (we see less of the journey), it distorts **numbers** (the figures we report are wrong), or it risks **moving money incorrectly** (rewards/payouts are wrong). The layers with money-moving potential — Client Backend and Attribution & Reward Logic — get the most defensive treatment.

---

## 1.1 SDK (Browser) Failures

These occur in the browser — hostile, uncontrolled territory. The platform assumes every one of these will happen. The SDK operates exclusively with publishable keys (`rai_pub_`) and is restricted to touch-event ingestion and the SDK endpoints (API Contract §5.4 trust boundaries). It carries `trust_level: low`: it may emit touch events only, never conversions, never revenue. Consequently, **no SDK failure can move money directly** — the entire layer affects coverage and the precision of numbers, never the correctness of a payout. This is a deliberate trust-zone property, not an accident.

### F-SDK-01: SDK Not Loaded

**Cause:** The client omitted the snippet, loaded it behind a condition that failed, an ad blocker or privacy extension blocked the script domain, or a CSP rule blocks the SDK origin.

**What breaks:** Zero touch events. No referral context captured, no cookies set, no widget rendered. Attribution falls back entirely to backend-supplied `referral_code` on conversion events — Method A (referee identity matching) or Method B (payment-provider metadata) per Product Spec §9. If neither is configured, conversions look organic.

**Dominant effect:** Coverage. **Money impact:** None directly — rewards are under-attributed, never over-attributed.

**Silent failure risk:** High. The client's site behaves normally; no user-visible error. The first sign is zero touch events in dashboards, which a client may not check for days.

### F-SDK-02: `userId` Not Provided in `init()`

**Cause:** The SDK is initialized without `userId`, typically because a developer copied the snippet without realizing `userId` is mandatory for the participant-facing widget (Product Spec §9 widget visibility; Responsibility Contract §5.5).

**What breaks:** The widget does not render. All campaigns use selective enrollment and there is no self-enrollment via the widget (Product Spec §7), so the widget only ever renders for an already-enrolled participant; without `userId` the SDK cannot identify that participant, so even an enrolled one is shown nothing. The SDK logs a console warning and reports the condition as init metadata. Referee touch tracking (link clicks, cookies) still works for visitors arriving via referral links — only the participant-facing surface is dead.

**Dominant effect:** Coverage (no participant surface → no referral volume). **Money impact:** Indirect under-attribution; a participant who cannot see their link cannot share it. The platform-sent enrollment email is the only other surface on which they can receive it (there is no participant-facing portal — Product Spec §7).

**Silent failure risk:** High. The SDK loads and tracks referee clicks, so the dashboard shows activity, masking the dead widget. Visible only via the "SDK loaded without userId" signal.

### F-SDK-03: Cookie Blocked or Cleared

**Cause:** Browser ITP/ETP policies, user-cleared cookies, incognito mode, aggressive privacy settings, or consent `denied`.

**What breaks:** The first-party cookies — `_rr_ref` (referral-code anchor), `_rr_sess` (session identity), `_rr_vid` (visitor/`anonymous_id`) — are unavailable. The SDK falls back to a localStorage backup of the `_rr_ref` payload (Responsibility Contract §2.4). If localStorage is also blocked, attribution relies on URL-parameter passthrough only; if the visitor leaves the landing page and returns directly, referral context is lost.

**Dominant effect:** Coverage. **Money impact:** Under-attribution — affected conversions are recorded as organic.

**Silent failure risk:** Medium. In-memory session touches still flow but lack the persistent referral context needed for multi-page-load attribution. Both cookie and localStorage failing together is undetectable until attribution coverage drops.

### F-SDK-04: Consent Unknown / CMP Delay

**Cause:** The client's CMP loads slowly, fails, or races the SDK. The SDK enters `pending` consent state and buffers touch events in memory (bounded queue with a short expiry per Product Spec §9 consent handling; Responsibility Contract §2.5).

**What breaks:** In `pending`, no cookies are set and events are *queued* (Product Spec §9 consent-mode table). If the CMP never resolves, the queue expires and events are dropped; if the visitor navigates away first, the queue is lost. This is distinct from `denied`, where **no cookies are set and no events are sent at all** — `denied` is silent by design, `pending` is a recoverable limbo.

**Dominant effect:** Coverage. **Money impact:** Under-attribution.

**Silent failure risk:** High. The SDK must never break the client's site, so CMP failures produce no visible error and no events — indistinguishable from "no visitors" without region-level analysis.

### F-SDK-05: Event Submission Failures

**Cause:** Network drops, ingestion endpoint transiently unavailable, publishable-key touch rate limit exceeded (10,000 touch events/min per key; SDK endpoints 500 req/min — API Contract §8.1), or DNS failure.

**What breaks:** Touch events are delayed or lost. The SDK retries with backoff. The platform's secondary deduplication (`referral_code + session_id + 5-minute bucket` — API Contract §5.3) safely collapses retried touches even when client-side `external_id` generation is unstable.

**Dominant effect:** Coverage. **Money impact:** Minimal — touches are input to attribution but do not move money.

**Silent failure risk:** Medium. Buffering and retry mask transient failures; sustained failure leaves gaps visible only after the fact.

### F-SDK-06: `sendBeacon` Failure on Page Unload

**Cause:** The browser lacks `sendBeacon`, kills the request before completion, or the payload exceeds the beacon size limit.

**What breaks:** The final event on a page — often the most attribution-significant — is lost.

**Dominant effect:** Coverage. **Money impact:** Minimal per event; aggregated, it degrades attribution quality.

**Silent failure risk:** High. `sendBeacon` provides no completion callback, so failure is unobservable client-side.

### F-SDK-07: `resolve-link` Failure

**Cause:** The link-resolution call (API Contract §4.3) fails on network error, or the Ingestion Event Rules Guard rejects it: `410` for an expired/archived/completed campaign or revoked link, `403` for a blocked participant's code, `422` for an unknown campaign (API Contract §5.5).

**What breaks:** The SDK cannot validate the code or fetch campaign context (cookie TTL, referee reward preview). For a genuinely invalid/expired code, not tracking is **correct**. For a transient network error, the SDK should persist the raw URL code and retry, but the code remains unvalidated until it succeeds.

**Dominant effect:** Coverage. **Money impact:** Under-attribution if legitimate codes are discarded on transient failure.

**Silent failure risk:** High for transient failures. For invalid/expired codes the behaviour is correct, but the visitor sees a seamless experience and the referring participant does not learn their link is dead. Note the interaction with **F-FRAUD/communication effects** (§4.4): a `410` on resolve-link can also mean the participant is *blocked*, not that the link expired — the two are indistinguishable from the SDK's side and must be separated server-side during debugging.

---

## 1.2 Client Backend Failures

These occur inside the client's trusted infrastructure and are the most dangerous class, because backend events carry `trust_level: high` (API Contract §5.4): revenue, context, and consent are all trusted as asserted. CRUD operations are *not* available to API keys — campaign management, reward approval, and payout initiation require OAuth2 JWT (API Contract §2). This caps the blast radius of a backend compromise but does nothing to protect against honest mis-integration, which is where most money risk actually lives.

### F-BE-01: Conversion Events Never Sent

**Cause:** The backend integration was never built, a broken build shipped, an internal queue silently failed, or the conversion call was removed in a refactor. Applies to Method A, where the backend explicitly emits conversions. Method B (payment-provider metadata) is not affected by this specific mode, since conversions arrive via billing webhooks.

**What breaks:** Everything downstream. No conversions → no attribution → no referral transitions → no reward evaluation → no payouts. The program is operationally dead; touch events keep arriving but lead nowhere.

**Dominant effect:** Moves money (by omission) — under-payout. **Money impact:** Participants are not compensated.

**Silent failure risk:** Very high. The platform has no way to know the client *should* be sending conversions. The only signal is a conversion rate that sits at zero.

### F-BE-02: Referral Code Not Forwarded

**Cause:** The SDK captures the code in `_rr_ref`, but the signup/payment flow never calls the attribution-retrieval method and omits `referral_code` from the backend conversion event (Responsibility Contract §5.2).

**What breaks:** The highest-fidelity path — direct referral-code stitching (priority 1, Event Model §7.3) — is unavailable. The platform falls back to session-based (priority 2) then email-based (priority 3) stitching. These succeed for same-device, same-email journeys and fail for cross-device or email-change cases.

**Dominant effect:** Distorts numbers / reduces coverage. **Money impact:** Under-attribution in ambiguous cases. Over-attribution is impossible — there is no probabilistic stitching (Event Model §7.3).

**Silent failure risk:** High. Fallback stitching still works often enough to mask the problem.

### F-BE-03: Revenue Submitted in Wrong Units

**Cause:** The client sends `revenue_amount: 49` instead of `4900` for a €49.00 payment because their internal systems use major units. Per the conversion schemas, `revenue_amount` is an integer in **minor** units (cents); `revenue_currency` must match the ISO-4217 three-letter pattern.

**What breaks:** Every financial figure is off by 100×. Revenue per referral, reward ROI, and all KPI dashboards show implausible numbers; percentage-based rewards calculate on 1/100th of the real amount. The Revenue Impact sub-score of Program Health (§3.4) is corrupted in the same direction.

**Dominant effect:** Distorts numbers; risks moving money on percentage rewards. **Money impact:** Under-payout on percentage rewards.

**Silent failure risk:** Medium. Schema validation rejects non-integers (so `49.00` is caught), but `49` is a valid integer and passes. The anomaly is visible in dashboards but needs client attention.

### F-BE-04: Duplicate Conversion Events (Non-deterministic `external_id`)

**Cause:** The client generates a random `external_id` per retry instead of deriving it from a stable domain key (a signup or payment identifier). `external_id` is the domain dedup key with a 90-day, per-tenant window (API Contract §1 idempotency, §5.3).

**What breaks:** Each retry is a new event. The same conversion is counted multiple times; the same reward is earned multiple times.

**Dominant effect:** Moves money — over-payout. **Money impact:** Participants receive duplicate rewards.

**Silent failure risk:** Medium-low. The client sees a successful `202 Accepted` per call; the duplication surfaces as multiple `reward.earned` domain events for one referee within minutes. Dedup cannot catch what the client never marked as the same event.

### F-BE-05: Events Sent Long After Occurrence

**Cause:** The client batches conversions and sends them days late with `occurred_at` set to "now" instead of the true time. Touch events must occur within 7 days, conversions within 30 days (Event Model §2.1).

**What breaks:** Attribution-window evaluation uses the wrong timestamp, so the window boundary is computed against a fictional time.

**Dominant effect:** Distorts numbers; can move money. **Money impact:** Unpredictable — both over- and under-attribution are possible near window edges.

**Silent failure risk:** High. Events are accepted as long as `occurred_at` is within the allowed window, true or not.

### F-BE-06: Secret Key Leaked

**Cause:** A `rai_live_` key is committed to a public repo, embedded in frontend code, or logged where it can be read.

**What breaks:** An attacker can submit fabricated conversions with `trust_level: high`. But the key **cannot** approve rewards, initiate payouts, create campaigns, or touch any CRUD endpoint — those need OAuth2 JWT (API Contract §2). The blast radius is event poisoning only.

**Dominant effect:** Moves money (bounded). **Money impact:** Significant but bounded. Fabricated conversions drive workflow transitions, fraud scoring, and reward evaluation; if auto-approval is enabled and fraud detection misses the pattern, fraudulent rewards may be earned and approved. Payout initiation still requires JWT, a second barrier, and fraud-safe degradation (§4.4) holds payouts under anomaly.

**Silent failure risk:** High until the attack produces visible effects (revenue/fraud anomalies).

### F-BE-07: Using API Keys for CRUD Operations

**Cause:** The client tries to create campaigns, manage rewards, or read analytics with a `rai_live_` key, assuming broad access (Responsibility Contract §5.9).

**What breaks:** Every such request is cleanly rejected with an authorization error stating that API keys are restricted to ingestion and SDK endpoints. No data is read or written.

**Dominant effect:** None — clean rejection. **Money impact:** None.

**Silent failure risk:** None; the error is explicit. The only cost is wasted integration time before the auth model is understood.

### F-BE-08: Payment-Provider Metadata Not Written (Method B)

**Cause:** The client configures the billing webhook integration (Stripe, Paddle, Chargebee, and now also PayPal, wire, or custom per the `payment_provider` enum) but never writes the referral code into the customer/payment metadata at creation time (Responsibility Contract §5.10).

**What breaks:** Payment webhooks arrive and are processed, but nothing attributes them to a referral. Revenue exists in the provider's system and in raw conversion volume, but not in referral attribution. The integration looks healthy (events arriving) with zero attribution.

**Dominant effect:** Moves money (by omission) — under-attribution. **Money impact:** Legitimate referrals go uncompensated.

**Silent failure risk:** High. The webhook path is technically "working." The only signal is "unattributed payments from a connected billing provider" in integration health (§3.1) and the Billing-Webhook-Attribution reconciliation job (§4.3).

### F-BE-09: Conversion Missing Referee Identity Anchor

**Cause:** The backend sends a conversion with neither `referee_email` nor `referee_external_id`. The conversion schemas require **one of the two** (an `anyOf` conditional).

**What breaks:** The event is rejected at schema validation before it reaches the workflow runtime. No conversion is recorded.

**Dominant effect:** Coverage / moves money by omission. **Money impact:** Under-attribution — the conversion never enters the pipeline.

**Silent failure risk:** Low-to-medium. The rejection is explicit in the response, but a client that does not inspect ingestion responses experiences it as a silent gap. This was a *silent* missing-field problem under the prior nested model; it is now a *hard, observable rejection*, which is the safer behaviour.

### F-BE-10: Recurring Conversion Missing `revenue_mrr`

**Cause:** The client sends `conversion.payment_completed` or `conversion.subscription_renewed` with `revenue_type: recurring` but omits `revenue_mrr`. The schema makes `revenue_mrr` conditionally required when `revenue_type` is `recurring`.

**What breaks:** The event is rejected at validation. For Renewal-Pulse campaigns (Product Spec §16) and all revenue-first (MRR/ARR) analytics (Product Spec §19), the recurring-revenue signal is the whole point, so the rejection blocks the campaign's core measurement rather than a peripheral field.

**Dominant effect:** Distorts numbers / coverage. **Money impact:** Under-attribution of recurring revenue and any MRR-based reward; the renewal cycle does not register.

**Silent failure risk:** Medium. Explicit rejection, but easy to miss because one-time payments from the same client succeed — the client sees "most conversions work" while every recurring one fails.

---

## 1.3 Network / Integration Failures

### F-NET-01: SDK-to-Platform Connectivity Loss

**Cause:** DNS failure, regional partition, or the ingestion endpoint unreachable from a visitor's geography.

**What breaks:** Touch events buffer in the SDK's in-memory queue, then drop. Attribution degrades in proportion to the outage. The localStorage backup preserves the `_rr_ref` payload across the outage so context survives even when live touches do not.

**Dominant effect:** Coverage. **Money impact:** Under-attribution only.

### F-NET-02: Client Backend-to-Platform Connectivity Loss

**Cause:** The client's infrastructure cannot reach the ingestion API — firewall change, DNS failure, IP-allowlist misconfiguration (API Contract §8).

**What breaks:** Conversions are not delivered. If the client retries within 30 days with a correct `occurred_at`, the events backfill cleanly; otherwise they are lost.

**Dominant effect:** Coverage / moves money by omission. **Money impact:** Under-attribution and under-payout during the outage; recoverable if retried within the `occurred_at` window.

### F-NET-03: Outbound Webhook Delivery Failure

**Cause:** The client's webhook endpoint is down, returns non-2xx, or times out. Retry schedule: 1 min → 5 min → 30 min → 2 h → 12 h → 24 h (7 attempts); 50 consecutive failures auto-disables the endpoint and notifies the client (API Contract §6.3).

**What breaks:** The client does not receive real-time notifications (`referral.converted`, `reward.earned`, `fraud.signal_raised`). If their reward-approval workflow depends on these in a manual-approval campaign, rewards sit in `Pending` until the client polls or the endpoint recovers.

**Dominant effect:** Distorts the client's view / delays money. **Money impact:** Delayed payouts for manual-approval campaigns; no incorrect amounts.

**Silent failure risk:** Medium. The auto-disable notification fires only after 50 failures.

### F-NET-04: Billing-Provider Inbound Webhook Failure (Method B)

**Cause:** The provider's webhook to the platform's inbound receiver fails — the provider cannot reach the platform, or the receiver is degraded (API Contract §6.5).

**What breaks:** Method B attribution stalls entirely. Payment events are not processed, conversions are not recorded, referral workflows do not advance.

**Dominant effect:** Coverage / moves money by omission. **Money impact:** Under-attribution for all Method B clients during the outage. Unlike F-NET-02, the client cannot retry — they did not originate the event, the provider did. Recovery depends on the provider's own retry behaviour plus platform-side replay.

**Silent failure risk:** Medium. The provider's delivery dashboard and the platform's "billing webhook last received" timestamp both show staleness, but the client may monitor neither.

---

## 1.4 Platform Ingestion & Internal Services

### F-ING-01: Ingestion Pipeline Backpressure

**Cause:** Traffic spike, SQS/SNS consumer lag, or a degraded downstream dependency (Redis, PostgreSQL). The pipeline is synchronous to `202 Accepted` (validate → dedup → Ingestion Event Rules Guard → enrich → emit) and asynchronous thereafter through Temporal (API Contract §5.7).

**What breaks:** Events are accepted but processing is delayed. `ingested_at` and `processed_at` diverge; `processing_status` stays at `accepted` rather than reaching `processed`. Attribution, reward evaluation, fraud checks, and webhook delivery all lag.

**Dominant effect:** Delays everything; eventually consistent. **Money impact:** Delayed payouts; no incorrect attribution, because processing completes correctly once drained.

### F-ING-02: Ingestion Event Rules Guard Rejections

**Cause:** The Ingestion Event Rules Guard (API Contract §5.5) evaluates campaign-level rules after schema validation and before the workflow runtime. Its responses are specific and must be read precisely:

- Unknown campaign → `422`.
- Campaign archived → `410 Campaign archived`; campaign completed → `410 Campaign completed`; after `ends_at` → `410 Campaign ended`.
- Before `starts_at` → `422 Campaign not yet active`.
- **Paused campaign → touch events `202` (buffered for resume); conversions for *existing* referrals `202`; only *new* referral creation is blocked.**
- Expired/revoked link → `410` / `403`.

**What breaks:** For genuinely expired links and not-yet-active campaigns this is correct behaviour. The case that surprises clients is a conversion arriving just after a campaign ends (`410`), and — importantly — the corrected paused-campaign semantics: a paused campaign does **not** reject conversions for referrals already in flight, so prior guidance that "paused → conversions rejected" is wrong and should not be used in triage.

**Dominant effect:** Coverage (when timing is off). **Money impact:** Under-attribution if a conversion lands after the campaign ends.

**Silent failure risk:** Low. The status codes are explicit; only clients that ignore response codes miss them.

### F-ING-03: Deduplication False Positive

**Cause:** Two genuinely distinct events share `tenant_id + external_id` because the client reused an `external_id` across event types or a legitimate second occurrence falls inside the 90-day window.

**What breaks:** A real event is silently discarded as a duplicate; the platform returns `200 OK` with `processing_status: "duplicate"`.

**Dominant effect:** Coverage / moves money by omission. **Money impact:** Under-attribution if the discarded event was a conversion.

**Silent failure risk:** Very high. The `duplicate` response is identical to correct deduplication; only cross-source reconciliation reveals the missing event.

### F-ING-04: Schema Validation Rejections (incl. malformed custom events)

**Cause:** An event fails JSON-Schema validation: a non-integer `revenue_amount`, a malformed `revenue_currency`, the missing identity anchor (F-BE-09), the missing `revenue_mrr` on recurring (F-BE-10), or — for `custom.recorded` — a nested object, which the schema forbids (custom payloads accept only flat primitives or flat arrays, with a mandatory dot-notation `event_name`).

**What breaks:** The event is rejected before ingestion. Nothing is recorded.

**Dominant effect:** Coverage. **Money impact:** Under-attribution if a conversion is rejected.

**Silent failure risk:** Low-medium. Rejections are explicit per-request but invisible to clients who do not inspect responses; they surface in aggregate as a spike in the rejection-by-reason metric.

### F-ING-05: ClickHouse Analytics Lag or Failure

**Cause:** ClickHouse cluster degradation, replication lag, or query saturation.

**What breaks:** Dashboard KPIs and Program Health roll-ups are stale or unavailable. The transactional pipeline (PostgreSQL + Temporal + Redis) continues unaffected.

**Dominant effect:** Distorts the *displayed* numbers without distorting the underlying data. **Money impact:** None directly — ClickHouse is a read path.

---

## 1.5 Attribution & Reward Logic Failures

### F-ATT-01: Identity Stitching Failure

**Cause:** A conversion lacks `referral_code` (bypassing priority-1 code stitching), its `session_id` matches no touch (bypassing priority-2 session stitching), and its `actor_email_hash` matches no touch (bypassing priority-3 email stitching). No probabilistic stitching is performed by policy (Event Model §7.3).

**What breaks:** The conversion is recorded as organic; the participant who drove it gets no credit.

**Dominant effect:** Moves money by omission. **Money impact:** Under-payout.

**Silent failure risk:** High. The conversion is recorded correctly — it simply cannot be attributed — and increments the unattributed-conversion counter rather than raising an error.

### F-ATT-02: Attribution Window Misconfiguration

**Cause:** A campaign sets a 7-day window for a product with a 30-day sales cycle. The campaign-level window overrides the program default (API Contract §3.2; Product Spec §10).

**What breaks:** Conversions causally linked to referrals fall outside the window and record as organic.

**Dominant effect:** Distorts numbers / moves money by omission. **Money impact:** Under-payout.

### F-ATT-03: Multi-Touch Attribution Disputes

**Cause:** Multiple participants touched the same referee. First-touch and last-touch assign 100% to different participants; multi-touch (V2, Product Spec §10/§19) splits by weight.

**What breaks:** Trust in the model. Surfaces as support tickets from the non-credited participant, not as a system error.

**Dominant effect:** Distorts perceived fairness. **Money impact:** Correct by the configured model's definition, disputed by the uncredited participant.

### F-ATT-04: Temporal Workflow / Pulse Failure

**Cause:** A Temporal worker crashes, a workflow times out, or a determinism violation fails a replay. Because each campaign runs a pulse-specific saga (Product Spec §16), the failure surface differs by pulse:

- **Conversion Pulse** (single trigger, refund-sensitive): a stuck workflow halts the transition to `Converted` and defers the refund/clawback-evaluation path.
- **Renewal Pulse** (multi-cycle loop, no clawback of already-paid cycles): a failure mid-loop can stall future cycles; already-paid cycles are never clawed back, so the risk is under-counting later renewals, not reversing past ones.
- **Feedback Pulse** (external verification dependency): a failure in the external-verification step leaves the referral unqualified, deferring — never falsely granting — the reward.

**What breaks:** Referral state transitions stall; reward evaluation, fraud checks, and fulfillment do not execute for the affected workflow.

**Dominant effect:** Delays money. **Money impact:** Delayed payouts; permanently stuck workflows require manual intervention. The saga's compensation logic prevents partial half-applied states.

### F-ATT-05: Variant Resolution Failure at Enrollment

**Cause:** Variant resolution happens at enrollment via a priority fallback chain (Product Spec §5; API Contract §3.3). If no variant segment matches and no Default Variant exists, resolution fails. Every campaign is supposed to carry a Default Variant (Product Spec §6), so this should only occur via data inconsistency or a setup race.

**What breaks:** Enrollment fails or the participant gets no link; the relevant enrollment call returns an error.

**Dominant effect:** Coverage. **Money impact:** None — no link means no referral activity, so no money is at stake.

**Silent failure risk:** Low. The API returns an error, but a client that ignores enrollment responses may leave participants silently without links (caught by the Enrollment-to-Link reconciliation job, §4.3).

### F-ATT-06: Reward Lifecycle Stalls and Reversals

**Cause:** The reward state machine is `Pending → Approved → Processing → Paid | Rejected | Reversed` (Product Spec §8), emitting the domain events `reward.earned`, `reward.pending_approval`, `reward.approved`, `reward.rejected`, `reward.fulfilled`, and `reward.clawed_back` (Event Model §5.2). Stalls arise from a missing approval (manual mode + lost webhook, F-NET-03), a fulfillment/payout-provider failure, or a clawback triggered by a post-conversion refund or chargeback (payment-reversal fraud signal).

**What breaks:** Rewards sit in `Pending`/`Approved` longer than the trust-tier hold period allows, or a `Reversed`/`clawed_back` transition fires after a refund.

**Dominant effect:** Delays or correctly reverses money. **Money impact:** Delayed legitimate payouts; correct clawback on genuine reversals. The hold periods (14/7/3 days / instant by trust tier — §3 below) exist precisely so a reversal can land before money leaves.

---

# 2. Detection Signals

This section defines what is measured, what a change means, and what is done about it. Two categories are kept strictly separate: **hard errors** (rejections, failures, stuck workflows — actionable immediately) and **confidence indicators** (coverage and attribution-quality metrics — surfaced as quality signals, never as request failures). The most dangerous failures in §1 are silent precisely because they live in the second category, so the confidence indicators carry as much weight here as the error rates.

---

## 2.1 Metrics That Matter

### Ingestion Layer

| Metric | Source | Normal Range | Anomaly Indicates |
|--------|--------|-------------|-------------------|
| `events.ingested.rate` (by `event_class`, `event_type`, tenant) | Event Ingestion Service | Stable ±20% WoW | F-BE-01 (conversion drop to zero), F-NET-02 (all-event drop), F-SDK-01 (touch drop) |
| `events.rejected.rate` (by reason-class, tenant) | API gateway / validator | < 2% of ingested | F-ING-04 (schema), F-BE-03 (units), F-BE-09 (missing identity), F-BE-10 (missing MRR) |
| `events.rejected.reason.distribution` | Validator | Stable mix | Spike in `missing_mrr` / `missing_identity` / `invalid_currency` isolates the exact mis-integration |
| `events.deduplicated.rate` (by tenant) | Deduplication service | < 5% of ingested | F-BE-04 (spike → non-deterministic `external_id`); also watch for F-ING-03 false positives |
| `events.processing_status.distribution` (by tenant) | Event pipeline | > 95% complete processing within 60 s | F-ING-01 (events stuck at `accepted`) |
| `events.ingestion_latency_p99` | Ingestion Service | < 200 ms | F-ING-01 |
| `events.processing_latency_p99` | Event pipeline | < 5 s | F-ING-01, F-ATT-04 (Temporal lag) |
| `ingestion_guard.response.distribution` (410/422/403/202-buffered) | Ingestion Service | < 1% non-202 | F-ING-02; 410 spike → expired campaigns/links or blocked participants; 422 spike → unknown/inactive campaigns |

### Attribution Layer

| Metric | Source | Normal Range | Anomaly Indicates |
|--------|--------|-------------|-------------------|
| `attribution.coverage_pct` (per tenant) | Attribution Engine | > 80% | F-BE-02, F-SDK-03, F-ATT-01 |
| `attribution.unstitched_conversions.rate` | Identity Service | < 15% | F-ATT-01, F-BE-02 |
| `attribution.window_expired.rate` (per campaign) | Attribution Engine | < 10% | F-ATT-02 (window too short), F-BE-05 (late events) |
| `attribution.stitching_method.distribution` (per tenant) | Attribution Engine | Code-based > 70% | F-BE-02 (low code-based → code not forwarded, leaning on weaker methods) |
| `attribution.method_b.unattributed_payments.rate` | Integration Service | 0% if Method B fully configured | F-BE-08 (metadata not written) |
| `revenue.recurring_share` & `revenue.mrr_present.rate` | Attribution Engine | Stable per tenant | Drop in MRR-present on recurring conversions → F-BE-10 surfacing upstream of rejection |

### Reward & Payout Layer

| Metric | Source | Normal Range | Anomaly Indicates |
|--------|--------|-------------|-------------------|
| `rewards.earned.rate` (per campaign) | Reward Evaluator | Proportional to conversion rate | Spike → F-BE-04 (duplicates); drop → F-BE-01 |
| `rewards.pending.age_p95` | Reward Service | Within trust-tier hold (instant → 14 d) | F-NET-03 (lost approval webhook) or F-ATT-06 (stall) |
| `rewards.fulfilled_to_approved_ratio` | Reward Service | > 90% | Fulfillment or payout-provider failure |
| `rewards.clawed_back.rate` (per campaign) | Reward Service | < 3% | Payment-reversal fraud, or phantom conversions from a client integration bug |
| `payouts.provider_error.rate` (per method) | Payout Service | < 1% | Provider-side failures (PayPal/Wise/SEPA) |

### Fraud Layer

| Metric | Source | Normal Range | Anomaly Indicates |
|--------|--------|-------------|-------------------|
| `fraud.signal.rate` (by signal type, severity) | Fraud Detector | Stable per tenant | Spike in self-referral / device-match (high severity) → coordinated abuse |
| `fraud.action.distribution` (auto-approve < 0.3 / review 0.3–0.7 / auto-block > 0.7) | Fraud Detector | Stable | Shift toward auto-block → attack or a scoring regression |
| `fraud.autoblock_to_manual_reject.ratio` | Fraud ops | Stable | Divergence → threshold mis-calibration |
| `velocity.limit_hits` (per referral code 100/h; per IP-hash 50/min) | Rate limiter | Rare | Sustained hits → scripted clicks / velocity abuse |

### SDK Health (Client-Side Telemetry)

| Metric | Source | Normal Range | Anomaly Indicates |
|--------|--------|-------------|-------------------|
| `sdk.load_success.rate` (per tenant) | SDK beacon / server logs | > 95% | F-SDK-01 (ad blockers, CSP, missing snippet) |
| `sdk.init_without_userid.rate` (per tenant) | SDK init metadata | 0% | F-SDK-02 (widget disabled) |
| `sdk.consent_mode.distribution` (granted/denied/pending) | SDK beacon | Stable per region | Pending-heavy → F-SDK-04; granted at ~100% with no CMP → consent misreported (silent, §2.3) |
| `sdk.cookie_available.rate` | SDK beacon | > 80% (region-dependent) | F-SDK-03 |
| `sdk.localstorage_fallback.rate` | SDK beacon | Low, > 0 only when cookies fail | F-SDK-03 (cookies failing, localStorage compensating) |
| `sdk.events_dropped.count` (per session) | SDK internal | 0 | F-SDK-05 (sustained network failure) |
| `sdk.resolve_link.failure_rate` / `.expired_410.rate` | SDK / gateway | < 1% / ~0% | F-SDK-07; 410 spike → dead links circulating *or* blocked participants |

### Webhook & Infrastructure

| Metric | Source | Normal Range | Anomaly Indicates |
|--------|--------|-------------|-------------------|
| `webhooks.delivery_success.rate` (per endpoint) | Webhook Service | > 99% | F-NET-03 |
| `webhooks.consecutive_failures.count` (per endpoint) | Webhook Service | 0 | Approaching auto-disable (50) |
| `billing_webhooks.last_received_at` (per integration) | Integration Service | Within billing-cycle cadence | F-NET-04 |
| `temporal.workflow_stuck.count` | Temporal visibility | 0 | F-ATT-04 |
| `temporal.task_queue_backlog` | Temporal | < 100 pending | Processing bottleneck |
| `clickhouse.replication_lag` | ClickHouse | < 10 s | F-ING-05 |
| `sqs.message_age_p99` | AWS SQS | < 30 s | F-ING-01 |

---

## 2.2 Anomaly Patterns

**Touch events arriving, zero conversions.** Touch ingest normal, conversion ingest zero for the tenant → F-BE-01. Not a platform problem; contact the client.

**Conversions arriving, low attribution.** Conversion ingest normal, `attribution.coverage_pct` below 60%, `stitching_method.distribution` low on code-based → F-BE-02. The client is not forwarding the referral code.

**Billing webhooks arriving, zero attribution (Method B).** `billing_webhooks.last_received_at` recent, `method_b.unattributed_payments.rate` near 100% → F-BE-08. Webhooks land but no customer carries the referral code in metadata.

**Recurring conversions failing while one-time succeed.** Rejection distribution shows `missing_mrr` concentrated on `revenue_type: recurring` → F-BE-10. Renewal/MRR analytics are blind even though the client believes the integration works.

**SDK loaded, widget never rendered.** `sdk.load_success.rate` normal, `sdk.init_without_userid.rate` elevated → F-SDK-02. Referee clicks track; participants cannot see or use the widget.

**Revenue per referral implausibly low.** Average `revenue_amount` ~100× below expectation → F-BE-03 (major instead of minor units). Confirm by testing whether values are non-integer when divided by 100.

**Duplicate rewards earned.** `events.deduplicated.rate` near zero but `rewards.earned.rate` elevated, multiple `reward.earned` for one referee within minutes → F-BE-04. Dedup is working; it cannot detect what the client did not mark as duplicate.

**410 spike on resolve-link or guard.** Separate the two meanings before acting: a campaign recently ended/archived, dead links circulating, *or* participants newly blocked (their codes now resolve to 410, §4.4). Cross-check `ingestion_guard.response.distribution` against `fraud.action.distribution`.

**Conversions from a tenant with almost no touches.** Large conversion volume against negligible touch volume → either Method B working without SDK (benign) or fabricated conversions (F-BE-06 / scripted). Cross-check fraud signals and Method-B attribution before drawing a conclusion.

---

## 2.3 Silent Failures

The failures that harm correctness without breaking any request are detected indirectly, through derived metrics, cross-source reconciliation, and fraud patterns rather than error logs.

| Silent Failure | Why It's Silent | How It Surfaces Indirectly |
|----------------|----------------|----------------------------|
| SDK missing on some surfaces | Platform only sees pages where the SDK loads | Coverage drops on specific funnels; client reports "not tracked on pricing page" |
| Consent `denied` at high rates | `denied` sends no events at all; indistinguishable from "no visitors" | Coverage low, conversions lack matching touches; needs region-level analysis |
| Consent misreported as `granted` | SDK reports `granted` while the CMP never actually loaded | `consent_mode.distribution` ~100% granted with no CMP load signal; cross-check against CMP telemetry |
| Backend silently dropping events | Events vanish before reaching the platform | Client's own conversion count exceeds the platform's — only cross-source reconciliation reveals it |
| Referral code stripped by an intermediary | Shorteners, some email clients, in-app browsers strip the parameter | Attribution falls back to email/session; `_rr_ref` never set |
| Plausible-but-wrong `occurred_at` | Timestamps "now" rather than true time, within the allowed window | Intermittent attribution failures near window boundaries (F-BE-05) |
| Method B metadata never written | Webhook path works; no attribution possible | "Unattributed payments from billing provider" + reconciliation job (F-BE-08) |
| Dedup false positive | `duplicate` response looks identical to correct dedup | Conversion-to-Attribution reconciliation finds a paid-but-unseen conversion (F-ING-03) |

A structural note that aids detection: **platform-sent email touches** (`touch.email_invitation_opened`, `touch.email_link_clicked`) are first-party and server-side, tied to participant consent rather than the referee's browser-cookie consent (Product Spec §22). They therefore keep flowing when the referee's browser CMP is `denied`, and act as a more reliable coverage floor than browser-side touches when diagnosing consent-driven coverage loss.

Everything in this subsection is surfaced as a **confidence indicator**, never as a hard error. A client whose coverage is 60% has a working integration with a measurable quality gap — not a broken one — and the platform communicates it that way (§3.3).

---

# 3. Client-Facing Monitoring

This section exists to keep clients honest about integration quality and attribution reliability. The premise is that the client's own analytics will report more referrals than the platform can defensibly attribute, and the platform's job is to show *exactly where* the gap comes from rather than to paper over it. Two distinct surfaces do this: **Integration Health** (is the data arriving correctly?) and **Program Health** (is the program performing?). They are deliberately separate, because a healthy program reading on bad data is the most expensive illusion the platform can sell.

---

## 3.1 Integration Health Dashboard

A per-tenant view (dashboard feature behind OAuth2 JWT — not an API surface) presenting traffic-light indicators with the underlying numbers and a remediation tooltip on each.

| Indicator | Status Logic | What the Client Sees |
|-----------|-------------|----------------------|
| **SDK Status** | Green: touch events in last 1 h. Yellow: last 24 h not 1 h. Red: none in 24 h. | "SDK active" / "No touch events in {N} hours" |
| **SDK Widget Status** | Green: > 80% of loads include `userId`. Yellow: 50–80%. Red: < 50%. | "Widget rendering" / "Loaded {N}× without userId — widget disabled for those sessions" |
| **Backend Conversion Delivery** | Green: conversions in last 24 h. Yellow: last 7 d. Red: none in 7 d. Gray: never received. | "Conversions received" / "Last conversion {N} days ago" |
| **Conversion Schema Health** | Green: < 2% rejected. Yellow/Red by rejection share, broken out by reason. | "X% of conversions rejected — {missing MRR / missing identity / invalid currency}" |
| **Referral Code Presence** | Share of conversions carrying `referral_code`. Green > 70%, Yellow 30–70%, Red < 30%. | "X% of conversions include a referral code" |
| **Attribution Coverage** | Green > 80%, Yellow 50–80%, Red < 50%. | Percentage + trend + how-to-improve |
| **Billing Integration (Method B)** | Green: attributed payments in 24 h. Yellow: webhooks arriving, no attribution. Red: no webhooks in 7 d. Gray: not configured. | "Payments being attributed" / "Receiving webhooks but no referral metadata" |
| **Webhook Health** | Per endpoint: Green < 5% failure, Yellow 5–20%, Red > 20% or disabled. | Endpoint + status + last successful delivery |
| **Revenue Sanity** | Green: no anomaly. Yellow: avg revenue/referral < €1. Red: values imply unit confusion. | "Revenue looks correct" / "Average is €0.47 — did you mean €47.00?" |

An **event timeline** at one-minute resolution overlays touch events (by subtype), conversions (by type), rejections (by reason), domain events (state transitions), and webhook deliveries (by endpoint/status), filterable by campaign, variant, and time range.

---

## 3.2 Warnings & Alerts

Alerts use thresholds with hysteresis to avoid flapping: a condition must persist beyond its window before firing, and must clear comfortably below the threshold before resolving. No alerts fire for never-active tenants; email is rate-limited to one per alert type per 24 h; dashboard alerts remain visible until resolved.

| Alert | Trigger | Severity | Delivery |
|-------|---------|----------|----------|
| No touch events | Zero for 6 h (previously active) | Critical | Dashboard + email |
| No conversion events | Zero for 48 h (previously active) | Critical | Dashboard + email |
| Conversions rejected | Rejection rate > 5% over 1 h, with dominant reason named | Warning | Dashboard + email |
| Recurring conversions failing | `missing_mrr` rejections concentrated on recurring over 24 h | Warning | Dashboard |
| Widget not rendering | > 50% of loads without `userId` over 24 h | Warning | Dashboard |
| Attribution coverage drop | Coverage falls > 20 pp over 7 d | Warning | Dashboard |
| Referral-code presence drop | Code presence on conversions falls > 30 pp over 7 d | Warning | Dashboard |
| Revenue anomaly | Avg revenue/referral deviates > 50× from 30-day mean | Warning | Dashboard + email |
| Unattributed billing payments | Method B active, > 10 unattributed payments in 7 d | Warning | Dashboard |
| Webhook endpoint disabled | 50 consecutive failures | Critical | Email |
| Webhook endpoint degraded | Success rate < 80% over 1 h | Warning | Dashboard |
| High deduplication rate | Dedup > 20% over 1 h | Warning | Dashboard |
| Reward approval backlog | Manual-approval rewards `Pending` beyond the trust-tier hold | Warning | Dashboard + email |
| Fraud-pressure spike | Fraud signals > 8% of referrals over 24 h for a campaign | Critical | Dashboard + email |
| Dead links / blocked codes | > 100 resolve-link 410s in 24 h for a campaign | Warning | Dashboard |

---

## 3.3 Confidence & Coverage Indicators

Every attributed referral carries a confidence level, and every analytics view carries coverage metadata. These are first-class: they appear on dashboards, in exported reports, and as metadata describing the quality of analytics responses — so a number is never presented without a statement of how much of the underlying reality the platform actually observed.

**Per-referral attribution confidence:**

| Confidence | Criteria | Display |
|------------|----------|---------|
| High | Direct `referral_code` match (stitching priority 1), single participant, conversion within the first half of the window | Green badge |
| Medium | Session- or email-based stitching (priorities 2–3), or multiple participants in the chain, or conversion in the last quarter of the window | Yellow badge + method used |
| Low | Email-hash stitching only, or edge-of-window, or attribution computed via replay | Orange badge + note that the code was absent |

**Three coverage metrics, reported per tenant and per campaign:**

- **Touch coverage** — how much of the journey the platform observed, derived from SDK load rate, consent distribution, and cookie availability. This is the metric most degraded by §1.1 failures.
- **Attribution coverage** — the fraction of conversions that could be attributed (the complement of the unstitched rate). Degraded by F-BE-02, F-SDK-03, F-ATT-01/02.
- **Revenue coverage** — the fraction of billing revenue that flows through the platform with attribution intact. Degraded by F-BE-08 and Method-B gaps; the reconciliation jobs (§4.3) supply the billing-side denominator.

Low coverage is communicated as a measured quality gap with a named cause and a remediation step, not as a failure — the goal is an honest, actionable picture, not a clean-looking one.

---

## 3.4 Program Health Score (Distinct from Integration Health)

Program Health Score (Product Spec §21) is a single 0–100 composite per program, recomputed nightly (emitting `health.recomputed`) and decomposed into four weighted sub-scores: **Referral Funnel (30%)**, **Revenue Impact (35%)**, **Fraud Pressure (20%)**, and **Audience Saturation (15%)**. It drives the AI Insights Panel and proactive alerts and answers "is the program working?"

The reliability-critical point is the interaction with integration quality: **integration failures depress Program Health sub-scores and must not be misread as poor program performance.** Concretely — F-SDK-01/02 and F-BE-02 depress the Funnel sub-score by erasing observed funnel steps; F-BE-03/08/10 depress the Revenue Impact sub-score by losing or mis-scaling revenue; and a client integration bug that produces phantom or duplicate conversions (F-BE-04) inflates Fraud Pressure through elevated reversals. For this reason, the Insights Panel gates Program Health interpretation on coverage: when touch, attribution, or revenue coverage is low, the panel attributes the sub-score movement to the integration gap first and suppresses program-performance conclusions until coverage recovers. A program reading 60/100 because of a missing SDK on the pricing page is a data problem, and the client is told so rather than being advised to change their incentives.

---

# 4. Platform-Side Safeguards

These are internal mechanisms that protect correctness and enable recovery against the failure taxonomy. They rest on the Event Model's hard guarantees: events are append-only and immutable once accepted (Event Model §1.4, §2.6), and stitching never rewrites events — it updates the referral record with the resolved identity and leaves the original events intact (§7.3). Immutability is what makes safe replay possible.

---

## 4.1 Dead-Letter Queues

Every processing stage routes events that fail after retry exhaustion to a per-service DLQ. A tracked event flows ingestion → SNS/SQS → consumer; on success it continues, and on failure after the consumer's retries it lands in that service's DLQ, where it is held for inspection and raises an alert once depth crosses the service threshold. DLQs are never auto-replayed — an engineer must inspect, diagnose, and decide.

| Service | DLQ | Alert Threshold | Typical Contents |
|---------|-----|-----------------|------------------|
| Event Ingestion | `dlq-event-ingestion` | > 10 / 5 min | Events passing HTTP validation but failing internal processing |
| Workflow Runtime | `dlq-workflow-runtime` | > 5 / 5 min | Domain events that failed to trigger or advance a referral workflow |
| Attribution Engine | `dlq-attribution` | > 5 / 5 min | Conversions causing unhandled exceptions during attribution |
| Reward Evaluator | `dlq-reward-eval` | > 5 / 5 min | Attribution results failing reward evaluation |
| Fraud Detector | `dlq-fraud` | > 5 / 5 min | Events failing fraud scoring. Non-blocking: events proceed to attribution even if scoring fails |
| Webhook Dispatcher | `dlq-webhooks` | > 50 / 1 h | Payloads that failed all 7 delivery attempts |
| Integration Service | `dlq-integrations` | > 5 / 5 min | Billing-provider webhook payloads (Method B) that failed processing |

Each DLQ entry retains the full event envelope plus error metadata: the error cause and its classification, the retry count, and the timestamps. Entries are retained 14 days, then archived to durable storage for the tenant's retention period. Depth over the threshold raises a P2 on-call incident; depth over 100 raises a P1. DLQs are surfaced on internal dashboards and through on-call notifications for systemic patterns, with tooling for manual re-inspection and scoped replay.

---

## 4.2 Replay Mechanisms

Replay reprocesses events from the immutable store. It is available for event ingestion, workflow re-driving, and attribution recomputation, and is always platform-initiated — never client-initiated.

- **Event replay (by time range + tenant)** reprocesses tracked events from the immutable store; idempotent via `event_id` deduplication in consumers.
- **Event replay (by `event_id` list)** handles specific events, typically from DLQ investigation, in small batches.
- **Attribution replay (per campaign + window)** recomputes attribution over an existing event set without re-ingesting. Rewards already in `Paid` are not auto-reversed; any reversal is a separate, explicit decision.
- **Workflow re-drive** restarts stuck Temporal sagas from a safe point, relying on the saga's compensation logic to avoid half-applied states.

Guardrails: replays are time- and tenant-scoped; every replay is logged in the audit trail with the engineer's identity, the scope, and the reason; idempotent processing guarantees a replay cannot double-count; replays above 100,000 events require two-engineer approval; and any attribution replay that could change rewards first produces a "rewards that would change" report for engineer approval before any state is modified.

---

## 4.3 Reconciliation Jobs

Periodic background jobs cross-check independent sources to catch the silent failures that no single request reveals — missing conversions, orphan rewards/payouts, and aggregate-vs-raw drift.

| Job | Schedule | What It Checks | Action on Mismatch |
|-----|----------|----------------|--------------------|
| Conversion-to-Attribution | 6 h | Every conversion in the last 24 h has an attribution result or an explicit "unattributable" marker | Flag orphaned conversions; trigger replay (catches F-ING-03) |
| Reward-to-Referral | Daily | Every `Converted` referral has a `reward.earned` (unless the campaign has no reward); every `Paid` reward has a payout record | Flag missing rewards / orphan payouts |
| Billing-to-Platform Revenue | Daily | Provider-reported revenue reconciles against platform-attributed revenue (the revenue-coverage denominator) | Flag "billing says paid, platform never saw conversion" (F-BE-08, F-NET-04, F-ING-03) |
| Payout-to-Reward | Daily | Every payout maps to an approved reward and respects the trust-tier cap | Flag orphan payouts and cap breaches |
| Participant-vs-Trust | Daily | Participant state is consistent with current trust/fraud signals | Flag participants whose state and signals disagree |
| Event-Count | Daily | PostgreSQL and ClickHouse event counts agree within 0.1% | Flag replication gaps; trigger ClickHouse backfill (F-ING-05) |
| Webhook-Delivery | 12 h | Every webhook-eligible domain event in 48 h has a delivery record per subscribed endpoint | Flag dispatcher routing gaps |
| Revenue-Sanity | Daily | Average revenue/conversion per tenant within 2 SD of its 30-day mean | Flag unit errors / integration bugs (F-BE-03) |
| Fraud-Score-Coverage | Daily | Every referral created in 24 h carries a fraud score | Flag referrals that bypassed scoring |
| Enrollment-to-Link | Daily | Every `Active` participant has at least one generated link | Flag enrolled-but-linkless participants (F-ATT-05) |

---

## 4.4 Fraud-Safe Degradation

When the system is uncertain, it withholds money. This is the operational expression of principle (1): under-pay rather than over-pay when fraud risk or data quality is in doubt, while ensuring benign data loss never becomes punitive (principle 2). Fraud actions are graduated by score and by checkpoint — auto-approve below 0.3, manual review 0.3–0.7, auto-block and alert above 0.7 — with the auto-block threshold tightening along the journey: referral creation > 0.8, qualification > 0.7, reward approval > 0.7, payout > 0.6 (Product Spec §7). The closer to money, the lower the tolerance.

When a referrer is blocked (or crosses the auto-block threshold), the communication effects are platform-wide and explain several otherwise-confusing symptoms (API Contract §8.2.1): their referral links resolve to `410` with no cookie set and touches rejected at the guard, the widget config returns hidden, rewards and payouts are held and excluded from new batches, and `participant.suspended` + `fraud.flagged` are emitted while reward/payout webhooks are suppressed. A `410` on resolve-link therefore has two meanings — expired link or blocked participant — and triage must distinguish them.

Component-down behaviour:

| Component Down | Degradation Behaviour | Rationale |
|----------------|----------------------|-----------|
| Fraud detection | All rewards shift to `Pending`; auto-approval suspended even for Advocates | Without scoring, auto-approving is unsafe |
| Attribution Engine | Conversions queued, not attributed; referral transitions halt; no rewards earned | Under-paying during an outage beats mis-attributing; replay on recovery |
| Reward Evaluator | Attribution completes; reward evaluation deferred; referrals reach `Converted` without `reward.earned` | Rewards computed after recovery |
| Temporal runtime | Workflows pause; new referrals are created but do not advance; domain events queue | Temporal is the state machine; advancing without it is unsafe |
| ClickHouse | Dashboards/Health stale; transactional pipeline continues | Analytics are read-only |
| Redis | Ingestion latency rises (cache misses fall through); rate limiting becomes approximate | System slows, does not stop |
| Integration Service (Method B) | Billing webhooks buffered; no Method B attribution until recovery; Method A continues | Provider retries; events processed on recovery |

**Payout freeze.** If more than one critical service is degraded at once (for example fraud detection + reward evaluator, or attribution engine + Temporal), payout processing is frozen for affected tenants: `Paid` rewards are not reversed, `Approved` rewards do not proceed to `Processing`, and `Pending` rewards do not proceed to `Approved`. The freeze lifts automatically once all critical services are healthy and a reconciliation job confirms consistency.

**Auditability and the benign-loss guarantee.** Every fraud-related action — each signal, the score and the threshold it crossed, the resulting state change, and any manual override — is written to the immutable decision-audit trail (Product Spec §22). Crucially, none of the coverage-loss failures in §1.1 and §1.3 feed the fraud score: a blocked cookie, a dropped beacon, a CMP timeout, or a lost webhook degrades coverage and is surfaced as a confidence indicator, never as a fraud signal, so benign data loss can never suspend a participant or trigger a clawback.

---

# 5. Support & Debugging Workflow

This is the stepwise process support, SRE, and product engineers use to investigate, and the deliberate limits on what they can see. It follows the event flow end to end — external event → ingestion → referral → reward → payout — and is aligned with the event model, the attribution model, and the SDK/backend contract.

---

## 5.1 Investigation Flow

**Tier 1 — Integration Health check (< 5 min).** Open the tenant's Integration Health dashboard (§3.1), read the traffic-light indicators (each names a likely cause), scan the event timeline around the reported time, and check the alerts tab. Most integration issues are diagnosable here without touching internal tooling.

**Tier 2 — Event trace (< 15 min).** Identify the entity (`referral_id`, `reward_id`, `external_id`, or referee email hash) and reconstruct the sequence: which touch events exist and with what `session_id`, `referral_code`, and `anonymous_id`; which conversion event(s) exist, whether `referral_code` was present, and the `occurred_at`; which domain events were produced and what attribution result and stitching method were used; the reward lifecycle events; and any fraud signals with their detection layer. Filter by `processing_status` to separate `accepted` events from `duplicate` ones and to spot events that failed processing.

**Tier 3 — Platform-side investigation (< 1 h).** Check DLQ depths per service, the Temporal execution for the referral's workflow, recent reconciliation-job outputs, and infrastructure dashboards (SQS backlog, ClickHouse lag, connection-pool utilization).

Worked investigation paths:

*"Our referrals aren't being attributed as expected."* Tier 1 → Attribution Coverage and Referral-Code-Presence indicators. Low code presence → F-BE-02. Otherwise Tier 2 trace a sample to see which stitching priority engaged and whether the window expired (F-ATT-02).

*"We see fewer referrals than clicks in our own analytics."* Compare the client's click count to platform touch ingest. A gap on the platform side points to F-SDK-01/03/04 (loads, cookies, consent) or code stripping; confirm via SDK Status, consent distribution, and cookie-availability signals.

*"Rewards didn't trigger for a conversion we believe was referred."* Tier 2 trace: confirm a conversion exists (else F-BE-01/F-NET-02 or the referee never converted); confirm `referral_code` presence (else fallback stitching, F-BE-02); check the attribution result (was another participant credited, F-ATT-03; did the window expire, F-ATT-02); check fraud signals and whether the participant is blocked/held (§4.4); check the reward lifecycle for a stall (F-ATT-06, often F-NET-03).

*"Payouts don't match what we see in our billing provider."* Run the Billing-to-Platform Revenue reconciliation for the tenant. "Provider paid, platform never saw a conversion" → F-BE-08 (Method B metadata) or F-NET-04 (inbound webhook). A platform-side count below the provider's also implicates F-ING-03 (dedup false positive). Trust-tier caps and hold periods explain timing differences that are not errors.

---

## 5.2 Inspectable Data

Three scopes exist, separated on purpose. Everything is scoped by tenant, by correlation id, and by time window.

**Client-accessible** (dashboard, and analytics retrieval endpoints under OAuth2 JWT): tracked touch and conversion events as full envelopes minus redacted PII (IP appears only as `ip_hash` plus country, never raw — Product Spec §22); referral lifecycle and state transitions; attribution results including model, confidence, stitching method, and contributing participants; reward lifecycle; fraud signals as types, scores, and detection layer (rule/ML/LLM) when a referral is flagged; webhook delivery logs; integration-health indicators; and participant trust scores and levels with a component breakdown.

**Support-accessible (internal only):** the full event-pipeline trace (distributed tracing/logs), DLQ contents, Temporal workflow executions, reconciliation outputs, per-key rate-limit utilization, analytics-store query logs, and raw billing-provider webhook payloads for Method B debugging.

---

## 5.3 Intentionally Opaque Areas

Some data is withheld even from internal users, to prevent privacy breaches, to avoid leaking fraud heuristics that would let abusers tune around them, and to prevent gaming of attribution or incentives.

| Withheld | Reason |
|----------|--------|
| Raw IP addresses and low-level device fingerprints | Only `ip_hash` + geo are retained (GDPR, Product Spec §22) |
| Full fraud feature vectors, weights, and exact thresholds | Exposure enables gaming; only signal types, scores, and detection layer are shown |
| AI model internals (incentive optimization, propensity scoring) | Only explainable outputs — the bounds satisfied, the threshold reached, and the high-level factors — are exposed (Product Spec §11, §21) |
| Other tenants' data | Absolute tenant isolation (API Contract §2) |
| Audit logs via API | Dashboard-only, to prevent programmatic access that could cover tracks |
| Full API-key values | Last four characters everywhere |
| Internal routing/queue metadata | Clients see effects, not infrastructure causes |

The discipline is "explainable, not exposed": a flagged referral shows which signal types fired and which checkpoint threshold was crossed, never the feature math that produced the score.

---

## 5.4 Correlation Keys & Checklists

The debugging chain runs from the client-provided `external_id` to the platform-assigned `event_id` (a ULID), to the `referral_id` (the workflow instance), through the attribution context (`campaign_id` → `variant_id` → `participant_id`), to the `reward_id` and finally the `payout_id`. Supporting links: `session_id` ties touches within a session; `anonymous_id` ties sessions for a consented visitor; `actor_email_hash` links across devices as a fallback; `click_id` ties a specific click to later events; `integration_id` identifies the Method B billing integration that produced an event; and the key prefix (last four) plus `sdk_version` identify the sender and build.

**"Participant referred someone but got no reward."** Find the `participant_id`; confirm touch events for the claimed referee exist; confirm a conversion exists (else F-BE-01 or no conversion); check `referral_code` presence (absent → fallback stitching); check the attribution result (different participant credited → F-ATT-03; window exceeded → F-ATT-02); check fraud signals and whether the participant is blocked or held (§4.4); check the reward lifecycle for a stall (F-ATT-06 / F-NET-03); check the trust level (held rewards for flagged/suspended participants are correct behaviour).

**"Dashboard shows zero conversions but we have real sign-ups."** Check Backend Conversion Delivery — Red/Gray → F-BE-01. If Method B, check Billing Integration — Yellow (webhooks, no attribution) → F-BE-08. If conversions exist but attribution fails, check coverage and stitching. If both are normal, check ClickHouse lag (F-ING-05, stale dashboard).

**"Recurring revenue isn't showing up."** Check Conversion Schema Health for `missing_mrr` rejections concentrated on `revenue_type: recurring` → F-BE-10. If recurring conversions are accepted but MRR is absent downstream, check that the client populates `revenue_mrr` rather than only `revenue_amount`.

**"Widget not showing for our users."** Check SDK Widget Status — Red → F-SDK-02 (`userId` missing). If `userId` is present, check enrollment: the widget renders only for pre-enrolled participants — all campaigns use selective enrollment — so a non-enrolled user correctly sees nothing; a `Suspended`/`Banned` participant has the widget hidden by design (Product Spec §7; §4.4). A blocked participant also sees their links resolve to `410`.

---

## 5.5 Feedback into Product & Architecture

Repeated support categories feed back into the platform rather than staying in tickets. A recurring mis-integration becomes an SDK or API ergonomics change (clearer required-parameter errors, a safer default), a new Integration-Health indicator or alert (the MRR-rejection and missing-identity breakdowns in §3.1–§3.2 exist because those failures were silent before they were surfaced), or a tightened guardrail or default (window defaults, dedup-key guidance, trust-tier holds). The test for whether a fix belongs in the product is simple: if the same ticket arrives more than a handful of times, the failure should have been visible on a dashboard or impossible to make — and the corresponding indicator, default, or validation is added.

---

> **Document status:** Living document. All failure modes, signals, and safeguards are grounded in Product Spec v4.0, API Contract v1.3, Event Model v3.0, and the SDK/Backend Responsibility Contract v2.0. Thresholds and alert configurations are calibrated during implementation.
> **Version:** 3.0 — **Date:** June 2026
>
> **Changes from v2.0** (reconciliation against the current companion specs):
> - **Companion references** updated to Product Spec v4.0, API Contract v1.3, Event Model v3.0.
> - **Flattened revenue:** all references updated from the nested revenue object / `amount` to the flat scalar fields (`revenue_amount`, `revenue_currency`, `revenue_type`, `revenue_mrr`, `revenue_arr`, `revenue_ltv_estimate`). F-BE-03 re-expressed on `revenue_amount`.
> - **New hard-rejection failures:** F-BE-09 (conversion missing both `referee_email` and `referee_external_id`) and F-BE-10 (recurring conversion missing `revenue_mrr`), reflecting the schema-level conditionals; F-ING-04 generalized to schema rejections including malformed `custom.recorded` payloads.
> - **Ingestion Event Rules Guard corrected:** paused campaigns buffer touches and accept conversions for existing referrals; only new referral creation is blocked. Added archived/completed/not-yet-active 410/422 semantics. (Replaces the prior "paused → conversions rejected" statement.)
> - **Program Health Score** added as a first-class client-facing layer (§3.4) with the four weighted sub-scores, kept explicitly distinct from Integration Health, with the coverage-gating interaction spelled out.
> - **Fraud model sharpened:** graduated score actions and per-checkpoint auto-block thresholds; fraud/trust communication effects (§4.4 — blocked participant → 410 links, hidden widget, held payouts, suppressed reward webhooks) integrated into degradation and debugging.
> - **Renewal Pulse / `subscription_renewed`** and pulse-specific workflow failure surfaces added to F-ATT-04; reward lifecycle aligned to the `Pending → Approved → Processing → Paid|Rejected|Reversed` states and the `earned/pending_approval/approved/rejected/fulfilled/clawed_back` events (F-ATT-06).
> - **Server-side email touches** noted as consent-independent of the browser CMP, as a coverage floor for diagnosing consent-driven loss.
> - **Rate limits** updated to the v1.3 figures (secret ingestion 5,000/min, batch 100/min, publishable touch 10,000/min, SDK 500/min) and business-level velocity limits (per code 100/h, per IP-hash 50/min) added as fraud/velocity signals.
> - **Style:** code-fenced diagrams (DLQ flow, correlation chain) converted to prose to comply with the no-code-blocks constraint; reconciliation jobs extended with Billing-to-Platform Revenue and Payout-to-Reward.
