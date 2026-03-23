# ReferralAI — SDK vs Backend Responsibility Contract

**Version:** 2.0  
**Date:** February 2026  
**Author:** Platform Engineering — Developer Experience  
**Status:** Draft for review  
**Aligned with:**
- Referral Revenue OS Product Specification v3.2
- Public API Contract v1.2
- Formal Event Model Specification v2.1

---

## 1. Design Principles

### 1.1 Why the Split Exists

The RefRev platform operates across two trust zones with fundamentally different risk profiles. The JS SDK runs in the browser — an environment the client does not control, where code can be inspected, modified, and replayed by any visitor. The client backend runs on infrastructure the client owns, authenticated with secret keys that never leave server memory.

This split is the load-bearing wall of attribution integrity and revenue protection. Every design decision in this contract flows from one question: **if this data were fabricated by a malicious browser, what breaks?** Touch events being fabricated wastes analytics capacity but does not move money. Conversion events being fabricated triggers reward payouts. That asymmetry dictates the entire boundary.

The platform enforces three distinct authentication mechanisms, each serving a different trust zone (API Contract Section 2.1):

- **Publishable API keys** (`rai_pub_`) — JS SDK in the browser. Restricted to touch event ingestion and `/v1/sdk/*` endpoints.
- **Secret API keys** (`rai_live_`) — Client backend. Permitted for all event types (touch, conversion, custom) via `/v1/events` and `/v1/events/batch`.
- **OAuth2 JWT** (Ory Kratos sessions) — Dashboard operators. Required for all CRUD operations on Programs, Campaigns, Variants, Referrals, Rewards, Payouts, Analytics, and configuration resources.

API keys — whether publishable or secret — cannot access Programs, Campaigns, Variants, Rewards, Segments, Analytics, Webhooks, or any configuration resource. Any attempt returns `403 authorization_error`. This is a hard boundary enforced at the API gateway, not by application logic.

### 1.2 Threat Model Assumptions

**The browser is hostile territory.** Any data submitted from a publishable key can be forged. IP addresses, user agents, timestamps, referral codes, and session IDs submitted in the request body from a browser are all untrusted. The platform derives context fields (`ip_hash`, `user_agent`, geo) server-side from the HTTP request itself when events arrive via publishable keys — it ignores what the browser claims these values are (API Contract Section 5.6, Event Model Section 3.2).

**The client backend is trusted but fallible.** Events submitted with a secret key are treated as `trust_level: high` (Event Model Section 2.1). Revenue figures, conversion signals, and identity data from the backend are taken at face value. The platform still validates schema and enforces idempotency, but it does not second-guess business data from the backend. The risk here is integration bugs, not malice.

**Partial integrations will happen.** Clients will ship the SDK before their backend integration is ready. They will forget to send conversion events for weeks. They will pass `referral_code` on some conversions but not others. The platform must degrade gracefully: attribution may be less precise, but it must never be silently wrong. Missing data should produce visible gaps in dashboards, not phantom referrals.

**Consent state is volatile.** A referee may grant consent on page load and revoke it three clicks later. The SDK must treat consent as a real-time gate, not a one-time check. The event envelope carries a dedicated `consent` object on every tracked event (Event Model Section 2.1), and the platform evaluates consent independently at conversion time.

**Participants have no platform access.** Per Product Spec Section 4, participants (the external actors who refer others) have no platform login. All participant-facing interactions flow through referral links, embedded widgets, email notifications, magic links, and QR codes. The SDK renders the widget surface through which participants interact. The backend enrolls participants and manages their lifecycle.

### 1.3 The Easy Path Is the Correct Path

If doing the right thing requires the client to remember a sequence of API calls, coordinate timing between frontend and backend, or manually construct attribution chains — they will get it wrong.

The platform supports two attribution methods (Product Spec Section 9), and the minimal integration for each must produce correct attribution out of the box:

**Method A (referee_id matching):** The SDK captures the referral code. The frontend calls `RefRev.getAttribution()` and passes the result to the backend. The backend sends a conversion event with `referee_external_id` and the referral code. Attribution is computed server-side.

**Method B (Payment Provider metadata):** The SDK captures the referral code. The frontend passes it to the backend at customer creation. The backend writes it into Stripe/Paddle/Chargebee customer metadata. The platform reads it from billing webhooks. No explicit conversion event needed from the client.

In both methods, the SDK handles the messy browser concerns (cookie management, URL parameter extraction, consent gating, session continuity, URL cleaning) without the client thinking about them. The backend integration reduces to: "when a user does something valuable, make sure we can trace it back to a referral code."

---

## 2. SDK Responsibilities

The JS SDK ("RefRev SDK") is the platform's eyes in the browser. It sees what happens before the user is identified, manages the referral context across navigation, renders the widgets that let enrolled participants share and track, and bridges attribution data from browser to backend. It operates exclusively with publishable keys (`rai_pub_`) and is subject to all low-trust constraints.

### 2.1 Tracking Scope

The SDK captures **touch events** — the behavioral signals that occur before and around conversion. The Event Model v2.1 (Section 3.3) defines six distinct touch event types, all of which the SDK can produce:

- **`touch.link_clicked`** — A referee clicks a referral link. The foundational attribution event.
- **`touch.link_shared`** — A participant shares their link via the widget (email, social, copy).
- **`touch.widget_viewed`** — A participant views the referral widget.
- **`touch.page_viewed`** — A referee views a page while a referral session is active.
- **`touch.email_invitation_opened`** — Captured by the platform's email tracking pixel (not SDK-originated, included for completeness).
- **`touch.email_link_clicked`** — Captured by the platform's email redirect handler (not SDK-originated).

Touch events are the raw material for attribution, but they are not attribution itself. Attribution is computed server-side by the platform's Attribution Engine after a conversion event arrives from the client backend or a billing webhook.

The SDK generates `session_id` values (stored in the `_rr_sess` cookie) and manages `anonymous_id` tokens (via the `_rr_vid` cookie or fingerprint fallback) that enable the platform to stitch anonymous pre-conversion touches to the identified user who eventually converts. This stitching happens platform-side — the SDK's job is to produce consistent, deduplicate-safe identifiers that survive page navigation.

### 2.2 Attribution Context Handling

When a visitor arrives via a referral link (URL containing `?ref=`), the SDK:

1. Extracts the `referral_code` from the URL parameter.
2. Calls `GET /v1/sdk/resolve-link?referral_code=...` (API Contract Section 4.4) to validate the code and retrieve campaign context, cookie TTL, and referee reward preview.
3. If valid: persists the referral code, click_id, and UTMs in the `_rr_ref` first-party cookie (90-day expiry) with localStorage backup.
4. Sends a `touch.link_clicked` event to the ingestion endpoint.
5. Cleans the URL by removing the `?ref=` parameter to prevent bookmark pollution (Product Spec Section 9).

The SDK provides a `RefRev.getAttribution()` method that returns the current attribution context (`ref_code`, `click_id`, `session_id`) for the frontend to pass to the backend. This method is backed by `POST /v1/sdk/attribution` (API Contract Section 4.5), which returns a server-validated version of the attribution context.

The SDK does **not** compute attribution. It does not decide which participant gets credit. It does not evaluate attribution windows. It captures and preserves the referral context so the platform can make those decisions when a conversion event arrives. The Attribution Context object (Event Model Section 5) — with its `campaign_id`, `variant_id`, `participant_id`, and window timestamps — is assembled and enriched server-side by the Event Ingestion Service, not by the SDK.

### 2.3 Widget Rendering

The SDK renders embeddable referral widgets that serve as the primary participant-facing interface. Participants have no platform login (Product Spec Section 4), so the widget is their entire interaction surface within the client's product.

On initialization, the SDK calls `GET /v1/sdk/widget-config?campaign_id=xxx&user_id=xxx` (API Contract Section 4.2) to determine what to render. The platform checks the user's enrollment status and returns one of four widget modes:

- **`active_referrer`** — Enrolled participant: shows referral link, sharing tools, stats (referrals sent, conversions, rewards earned).
- **`enrollment_cta`** — Not enrolled, campaign is `open`: shows "Start Referring" call-to-action with reward preview.
- **`hidden`** — Not enrolled, campaign is `selective`: widget does not render. User doesn't know it exists.
- **`hidden`** — Enrolled but blocked/suspended: widget does not render.

When a user clicks the CTA in `open` enrollment mode, the SDK calls `POST /v1/sdk/enroll` (API Contract Section 4.3), which registers the user as a participant, resolves their variant (per the fallback chain in Product Spec Section 5), generates their link, and switches the widget to `active_referrer` mode.

Widget interactions that produce events (share button clicks) are emitted as `touch.link_shared` events through the ingestion pipeline.

**`userId` is mandatory.** Without `userId` passed in `RefRev.init()`, the widget does not render. The SDK logs a console warning and the integration health dashboard flags repeated SDK loads without `userId` (Product Spec Section 9).

### 2.4 Retry, Buffering, and Delivery

The browser is an unreliable delivery environment. Networks drop, tabs close, pages reload. The SDK implements:

**Automatic retry with exponential backoff** for failed event submissions. The platform's secondary deduplication (composite key: `referral_code + session_id + 5min_bucket`, per API Contract Section 5.4) ensures retried touch events are safely deduplicated even if the SDK cannot guarantee stable `external_id` generation.

**In-memory event queue** that holds up to 50 events for up to 30 minutes (Product Spec Section 9). This queue is primarily used during the `pending` consent state — events are captured but not sent until the user's consent choice resolves. The queue is flushed on `setConsent('granted')` and cleared on `setConsent('denied')`.

**Page-unload handling** using `navigator.sendBeacon` or equivalent to ensure final events are not lost on navigation.

**localStorage backup** for attribution data (`_rr_ref` cookie contents) as a fallback when cookies are cleared (Product Spec Section 9).

### 2.5 Consent Handling

The SDK integrates with the client's Consent Management Platform (CMP). The Product Spec (Section 9) defines three consent modes with specific behaviors for each:

**`granted`** — Full tracking mode.
- Cookies set: `_rr_ref` (attribution, 90 days), `_rr_vid` (visitor ID, 1 year), `_rr_uid` (user ID, 1 year), `_rr_sess` (session, session-scoped), `_rr_consent` (consent level, 1 year).
- localStorage backup: same data stored as fallback.
- All touch events sent to platform with `tracking_consent: granted` in the consent envelope section.
- Widget fully functional with personalized stats and share tracking.

**`denied`** — Zero-tracking mode.
- No cookies set. No localStorage used. No events sent to the platform.
- Widget shows but limited: generic referral link (if user identified via `userId`), no stats, share buttons work but no tracking.
- Attribution still possible via URL parameter passthrough to the backend and server-side attribution (Method B).

**`pending`** — Waiting for user choice.
- No cookies set yet. No localStorage used yet.
- Events queued in memory (up to 50 events, 30-minute expiry).
- Widget shows optimistically (assumes consent will be granted).
- On `setConsent('granted')`: cookies set, queue flushed, normal operation.
- On `setConsent('denied')`: queue cleared, switches to denied mode.

The SDK provides CMP integration via `RefRev.setConsent()` with documented examples for OneTrust, Cookiebot, and Osano (Product Spec Section 9). Consent status (`tracking_consent`) is a required field on every tracked event in the event envelope (Event Model Section 2.1).

### 2.6 Explicit Boundaries

**The SDK CAN:**
- Extract referral codes from URL parameters (`?ref=`)
- Resolve referral links via `GET /v1/sdk/resolve-link` to validate codes and retrieve campaign context
- Set and read first-party cookies (`_rr_ref`, `_rr_vid`, `_rr_uid`, `_rr_sess`, `_rr_consent`) on the client's domain
- Use localStorage as a backup for attribution data
- Generate session IDs and anonymous visitor identifiers
- Emit touch events (`type: "touch"`) — all six subtypes — to the event ingestion endpoint
- Render referral widgets with enrollment-status-aware behavior
- Trigger self-enrollment via `POST /v1/sdk/enroll` for `open` enrollment campaigns
- Retrieve server-validated attribution context via `POST /v1/sdk/attribution`
- Submit consent signals (consent status travels on every tracked event)
- Track custom events via `RefRev.track()` for segmentation purposes
- Buffer and retry failed event submissions
- Clean URLs by removing `?ref=` parameters after capture

**The SDK MUST:**
- Require `userId` in `RefRev.init()` for widget rendering; log a console warning and disable widgets if absent
- Check consent status before every tracking action; never fire events optimistically during `pending` state
- Attach `tracking_consent` (as `consent_status` in the API) to every touch event (required per Event Model Section 2.1 and API Contract Section 5.3)
- Attach `session_id` to every event for identity stitching
- Persist referral code in `_rr_ref` cookie immediately upon extraction and validation from URL
- Call `resolve-link` to validate referral codes before setting cookies and beginning tracking
- Use HTTPS exclusively
- Include `sdk_version` in the `source` block of every event
- Respect the platform's rate limits (10,000 touch events/minute per publishable key)
- Fail silently from the user's perspective — SDK errors must never break the client's site
- Handle all three consent modes with the correct behavior as specified

**The SDK MUST NOT:**
- Submit conversion events (`type: "conversion"`). The platform returns `403 Forbidden`. This is a hard enforcement at the ingestion boundary (API Contract Section 5.6).
- Submit custom events via the publishable key. Custom events require a secret key (Event Model Section 3.5).
- Submit revenue data in any form. Revenue amounts from publishable keys are rejected.
- Submit batch events. `/v1/events/batch` requires a secret key.
- Claim or spoof `context.ip_hash` or `context.user_agent`. The platform ignores these from publishable key requests and derives them server-side.
- Store or transmit raw email addresses in event payloads. The SDK works with hashed identifiers and anonymous tokens. (`user_email` is only provided to `POST /v1/sdk/enroll` for participant registration.)
- Compute, store, or cache attribution decisions. Attribution is a server-side concern.
- Call any CRUD endpoint for Programs, Campaigns, Rewards, Segments, Analytics, or Webhooks. API keys cannot access these resources — they require OAuth2 JWT authentication.
- Approve, reject, or trigger any reward action.
- Make decisions about referral eligibility, fraud, or reward qualification.
- Set cookies or send events when consent is `denied`.

---

## 3. Backend Responsibilities

The client backend is the source of truth for everything that moves money or confirms identity. It operates with secret API keys (`rai_live_`) for event ingestion, and its events are treated as `trust_level: high` (Event Model Section 2.1). The platform trusts the backend's data — which means the backend must earn that trust by sending correct, timely, and complete signals.

### 3.1 Authoritative Events

The client backend is the **sole authorized source** for conversion events. The Event Model v2.1 (Section 3.4) defines these conversion types, all requiring `trust_level: high`:

**`conversion.signup_completed`** — Referee completed registration. Primary trigger for the Signup Pulse. Must include `referee_email` or `referee_external_id` for identity resolution.

**`conversion.payment_completed`** — Referee made a payment. Primary trigger for the Conversion Pulse. Carries the `revenue` object (amount in minor currency units, currency code, type, MRR/ARR). This event is what turns referral activity into attributed revenue.

**`conversion.subscription_renewed`** — Referred customer renewed. Primary trigger for the Renewal Pulse. Feeds LTV and retention analytics. Can trigger recurring reward structures (revenue share).

**`conversion.feedback_submitted`** — Referee submitted a review, NPS, or testimonial. Primary trigger for the Feedback Pulse (Event Model Section 3.4). Carries `feedback_type`, `rating_value`, `feedback_platform`.

The backend may also send **custom events** (`type: "custom"`) for segmentation and AI purposes. These do not directly trigger referral workflow transitions but are stored for segment rule evaluation, propensity modeling, and analytics. Certain custom events (`user.reactivated`, `migration.completed`, `newsletter.subscribed`) match specific Pulse triggers and are internally translated to conversion signals by the Segmentation service (Event Model Section 3.5).

### 3.2 Revenue and Payment Events

All monetary data must come from the backend. Per API Contract Section 1.9, revenue amounts are non-negative integers in minor currency units (cents), always accompanied by an ISO 4217 currency code. Negative values (refunds, chargebacks) are handled through the clawback mechanism, which requires explicit justification and creates an immutable audit trail.

The revenue sub-schema (Event Model Section 3.4) includes: `amount` (required), `currency` (required), `type` (`one_time` or `recurring`), `mrr` (required for recurring), `arr`, and `ltv_estimate`. The `ltv_estimate` field feeds the AI subsystem's incentive optimization (Product Spec Section 11).

### 3.3 Payment Provider Webhooks (Method B)

For clients using Stripe, Paddle, or Chargebee, the platform supports an alternative attribution path (Product Spec Section 9, Method B). The client backend writes the referral code (from `RefRev.getAttribution()`) into the payment provider's customer metadata at customer creation time. The platform then reads this metadata from billing webhooks (`invoice.payment_succeeded`, `checkout.session.completed`, etc.) to perform attribution without the client sending explicit conversion events.

This path produces tracked events with `source.origin: webhook_relay` and `trust_level: high` (Event Model Section 3.2). The platform verifies webhook signatures before processing.

The backend's responsibility for Method B is to write `refrev_ref_code` and `refrev_click_id` into customer metadata at creation. All subsequent payments from that customer are automatically attributed.

### 3.4 Participant Enrollment

The backend is responsible for registering participants (referrers) in the platform. Per Product Spec Section 7, enrollment methods include:

- **API single:** `POST /v1/referrers` (OAuth2 JWT, `referrers:write` scope)
- **API bulk:** `POST /v1/referrers/batch` (up to 1000 per request)
- **Link generation:** `POST /v1/referrers/{id}/links` to generate campaign-specific referral links after enrollment

When a link is generated, the platform resolves the participant's variant assignment for that campaign using the fallback chain (Product Spec Section 5): evaluate segments in priority order → match → allocate by weight → fall back to default variant. The link is bound to the resolved variant, ensuring the participant knows their exact reward when sharing.

The SDK can also trigger enrollment for `open` campaigns via `POST /v1/sdk/enroll`, but only `selective` campaigns — where specific users are pre-enrolled — require backend-driven enrollment.

### 3.5 Fraud-Sensitive Actions

The backend is the only authorized actor for operations that directly affect money flow. All of these require OAuth2 JWT authentication (not API keys):

**Reward approval** (`POST /v1/rewards/{id}/approve`) — Even when auto-approval is configured, manual override requires `rewards:write` scope.

**Reward rejection** (`POST /v1/rewards/{id}/reject`) — Rejecting a pending reward with an audit reason.

**Reward clawback** (`POST /v1/rewards/{id}/clawback`) — Reversing a fulfilled reward. Requires a `reason` field (mandatory, per API Contract Section 3.8). Creates an immutable `reward.clawed_back` domain event. Supports partial clawback.

**Payout initiation and confirmation** — Creating a payout batch and confirming disbursement is a two-step process (API Contract Section 3.10). `POST /v1/payouts` creates in `pending` state; `POST /v1/payouts/{id}/confirm` triggers disbursement.

**Referral rejection** (`POST /v1/referrals/{id}/reject`) — Manually rejecting a referral that automated checks did not catch.

**GDPR erasure requests** (`POST /v1/erasure-requests`) — Triggering data anonymization for a specific actor (API Contract Section 3.14). Requires `referrers:write` scope. Processed within 30 days per GDPR.

**Participant blocking** (`POST /v1/referrers/{id}/block`) — Disables all links, freezes rewards (API Contract Section 3.5).

### 3.6 Explicit Boundaries

**The backend MUST:**
- Send all conversion events with a secret key (`rai_live_`) — the platform returns `403` for conversions from publishable keys
- Include `referee_email` or `referee_external_id` on every conversion event for identity resolution
- Include `external_id` on every event for idempotent deduplication (90-day window, per API Contract Section 1.4)
- Send revenue data as non-negative integers in minor currency units with ISO 4217 currency codes
- Handle reward approval/rejection for manual-approval campaigns via OAuth2 JWT
- Handle clawbacks when payments are refunded or fraud is discovered post-fulfillment
- Protect the secret key (`rai_live_`) — it must never appear in frontend code, browser logs, or client-accessible storage
- Use OAuth2 JWT authentication for all CRUD operations (Programs, Campaigns, Rewards, etc.)
- Manage participant enrollment for `selective` campaigns (API, CSV, CRM, or auto-rules)
- For Method B: write `refrev_ref_code` and `refrev_click_id` into Stripe/Paddle/Chargebee customer metadata at customer creation

**The backend SHOULD:**
- Include `referral_code` on every conversion event. This is the highest-fidelity attribution path — direct linkage without probabilistic matching. Identity stitching priority is: (1) referral-code-based, (2) session-based, (3) email-based (Event Model Section 6.4).
- Forward the referral code from the SDK (via `RefRev.getAttribution()`) through its own signup/payment flow so it is available at conversion time
- Subscribe to webhooks (`referral.converted`, `reward.earned`, `fraud.signal_raised`, per API Contract Section 6.2) rather than polling for state changes — the ingestion endpoint returns `202 Accepted` and processing is asynchronous
- Send server-side touch events for mobile apps and server-rendered pages that bypass the JS SDK
- Include optional enrichment fields (`payment_provider`, `plan_id`, `billing_interval`, `is_first_payment`, `trial_converted`, `ltv_estimate`) to improve AI model accuracy
- Pass participant `attributes` (plan, country, MRR) at enrollment for segment evaluation and variant resolution

**The backend MUST NOT rely on the SDK for:**
- Conversion signals — the SDK cannot send them (hard enforcement)
- Revenue data — the SDK cannot include it (hard enforcement)
- Custom events — these also require a secret key (Event Model Section 3.5)
- Identity confirmation — the SDK works with anonymous and hashed identifiers; confirmed identity (email, external ID) must come from the backend
- Fraud-sensitive actions (approval, rejection, clawback, payout) — these require OAuth2 JWT, not API keys
- Attribution decisions — the backend sends the facts (events); the platform computes attribution
- CRUD operations on Programs, Campaigns, Variants, Segments — these require OAuth2 JWT
- Consent revocation enforcement or GDPR erasure — these require scoped OAuth2 credentials

---

## 4. Shared Responsibilities

Some concerns span the SDK-backend boundary. Neither side owns them exclusively — both must participate for them to work.

### 4.1 Correlation IDs and Idempotency

The platform uses two distinct idempotency mechanisms (API Contract Section 1.4):

**Event ingestion (`/v1/events`)** uses `external_id` in the request body as the domain-level deduplication key. Scoped to tenant. 90-day window. Both SDK and backend must generate these:

The **SDK** generates `external_id` for touch events. In degraded browser conditions, the SDK's `external_id` may be unstable. The platform compensates with secondary deduplication (`referral_code + session_id + 5min_bucket`), but the SDK should make its best effort.

The **backend** generates `external_id` for conversion and custom events. These IDs should be deterministic and derived from domain identifiers (e.g., `signup:{user_id}`, `payment:{stripe_payment_id}`) to ensure retries produce the same `external_id`.

**All other POST endpoints** use an `Idempotency-Key` HTTP header. 24-hour window. Required on all resource-creating POSTs. The backend should generate these as ULIDs.

Both must generate unique, non-colliding IDs scoped to the tenant. SDK-generated and backend-generated IDs do not need to coordinate — deduplication is scoped to `tenant_id + external_id`.

### 4.2 Identity Resolution

Identity resolution links anonymous pre-conversion touches to the identified user who converts. This requires both sides.

The **SDK** provides raw identity signals: `session_id` (from `_rr_sess` cookie, stable within a browser session), `anonymous_id` (from `_rr_vid` cookie, stable across sessions with consent), and `referral_code` (the attribution anchor, from `_rr_ref` cookie). These are attached to every touch event.

The **backend** provides confirmed identity: `referee_email` and/or `referee_external_id` on conversion events. This is the moment the anonymous referee becomes known.

The **platform** performs stitching in the following priority order (Event Model Section 6.4):

1. **Referral-code-based** — If the conversion event carries `referral_code`, direct linkage. This is also how Method B works — the code stored in Stripe/Paddle/Chargebee metadata provides the link. Highest reliability.
2. **Session-based** — Matching `session_id` between touches and conversion. Highest confidence for same-session scenarios.
3. **Email-based** — Matching `actor_email_hash` between touches and conversion events.
4. **Probabilistic stitching is explicitly not performed** — no fingerprint correlation, no IP matching. This is a deliberate constraint for attribution integrity and GDPR compliance.

The critical handoff: the referral code must travel from SDK → frontend → backend → conversion event. This is the single most impactful thing a client can do for attribution accuracy. `RefRev.getAttribution()` exists specifically to make this handoff easy.

### 4.3 Error Recovery

**SDK failures** (network errors, consent revocation mid-session, cookie blocking) degrade touch event coverage but do not break the referral pipeline. The platform expects gaps in touch data and still attributes conversions when the backend sends events with `referral_code` or matching `referee_email`. Dashboards surface "attribution coverage %" as a quality KPI.

**Backend failures** (missed conversion events, incorrect `external_id`, missing identity fields) are more serious because they affect reward payouts and revenue attribution. Recovery mechanisms: conversion events can be sent up to 30 days after occurrence (via `occurred_at` timestamp), the batch endpoint allows bulk backfill (up to 100 events, 1MB), and deduplication ensures retrying is always safe.

**Platform failures** are handled by at-least-once delivery and idempotent processing. Events accepted with `202 Accepted` are guaranteed to be processed. The `processing_status` field on events and the webhook system provide visibility into processing state. The Business Rules Guard (API Contract Section 5.7) provides immediate feedback when events fail campaign-level validation (expired links return `410`, paused campaigns handle touches conditionally, unknown campaigns return `422`).

### 4.4 Debugging Support

The **SDK** includes `sdk_version` on every event and generates `session_id` values correlating all browser activity within a visit. These appear in the event's `source` block and enable tracing a visitor's journey.

The **backend** includes `external_id` values derived from its own domain and can use the `metadata` field (20 keys, 5 KB, opaque to the platform) for internal correlation.

The **platform** assigns `event_id` (ULID, time-ordered), records `ingested_at` and `processed_at` timestamps, and preserves the full `source` block (`origin`, `trust_level`, `api_key_prefix` last four characters, `sdk_version`, `producing_service`). Events expose `processing_status` (`accepted`, `processed`, `failed`, `duplicate`) via the read API. The event retrieval endpoint supports filtering by `referral_id`, `campaign_id`, `event_name`, and `processing_status`. Every response includes `X-Request-Id` for tracing.

Both sides should treat `external_id` as the primary correlation handle. The platform links `external_id` → `event_id` → `referral_id` → `attribution` → `reward`, providing a complete chain from client action to platform outcome.

---

## 5. Common Integration Mistakes

### 5.1 Sending Conversion Events from the Browser

**What happens:** Client puts a conversion call in their frontend JavaScript using the publishable key after a user signs up.

**Why it happens:** The frontend already has the SDK loaded. The signup form is in the browser.

**Why it's wrong:** `403 Forbidden`. Conversion events from publishable keys are hard-blocked at the ingestion boundary. Even if they weren't, browser-originated conversions could be fabricated by anyone with DevTools.

**How the platform prevents it:** The publishable key scope is `events:write:touch` — touch events only (API Contract Section 2.2). Conversion and custom events are rejected at the API gateway level.

### 5.2 Not Forwarding the Referral Code to the Backend

**What happens:** The SDK correctly captures the referral code in the `_rr_ref` cookie, but the client's signup/payment flow does not call `RefRev.getAttribution()` and does not include the referral code on the conversion event sent from the backend.

**Why it happens:** The frontend and backend teams are separate groups. Neither realized they needed to bridge the code across the boundary.

**Why it's wrong:** Without `referral_code` on the conversion event, the platform falls back to email-based matching (priority 3 in the stitching order). This works in many cases but fails for cross-device conversions, email changes, and multi-referral scenarios.

**How the platform prevents it:** The platform surfaces "attribution coverage %" in dashboards. The `RefRev.getAttribution()` method and its server-validated endpoint (`POST /v1/sdk/attribution`) exist specifically to make this handoff trivial. The integration health dashboard flags repeated conversions arriving without referral codes.

### 5.3 Submitting Revenue with Wrong Units

**What happens:** Client sends `"amount": 49` for a €49.00 payment instead of `"amount": 4900` (minor currency units / cents).

**Why it happens:** The client's systems use major currency units and the developer missed the minor-units requirement.

**Why it's wrong:** Revenue attribution, percentage-based rewards, and all financial KPIs are off by 100x.

**How the platform prevents it:** Revenue validation rejects non-integer values (API Contract Section 7.2). The API Contract (Section 1.9) specifies minor units with examples. Analytics dashboards surface average revenue per referral, making 100x errors visible quickly.

### 5.4 Missing `external_id` or Using Non-Deterministic IDs

**What happens:** Client generates random `external_id` values on every retry, or omits it entirely.

**Why it happens:** The developer treats `external_id` as throwaway rather than a deliberate deduplication handle.

**Why it's wrong:** Without stable `external_id` values, retried events create duplicates — same conversion counted twice, same reward earned twice. For SDK touch events, the platform has secondary deduplication; for backend conversion events, `external_id` is the only defense.

**How the platform prevents it:** `external_id` is required on all events (API rejects without it). Duplicates return `200 OK` with `processing_status: "duplicate"` providing immediate feedback. Documentation recommends deriving from domain identifiers (`signup:{user_id}`, `payment:{stripe_payment_id}`).

### 5.5 Not Providing `userId` in SDK Init

**What happens:** Client initializes the SDK without `userId`. Referee tracking works (link clicks, cookies), but the widget never renders.

**Why it happens:** The developer copies the SDK snippet and doesn't realize `userId` is required for widget functionality.

**Why it's wrong:** Without `userId`, the platform cannot check enrollment status. The widget cannot determine what to show — active referrer, enrollment CTA, or hidden. Participants never see their referral link or stats.

**How the platform prevents it:** The SDK logs a console warning: `"[RefRev] Widget disabled: userId not provided."`. The integration health dashboard flags "SDK loaded X times without userId." Referee touch tracking continues to work even without `userId` — only the widget is disabled.

### 5.6 Ignoring Consent Modes

**What happens:** Client initializes the SDK with `consent: 'granted'` always, regardless of actual CMP state, because "we just want tracking to work."

**Why it happens:** Consent gating feels like friction. The developer wants maximum data collection.

**Why it's wrong:** GDPR violation. The platform records `tracking_consent: granted` on every event, creating a false audit trail. If a regulatory inquiry occurs, the client cannot demonstrate valid consent.

**How the platform prevents it:** The `consent` field is part of the event envelope (Event Model Section 2.1) and the platform uses it for processing decisions. The Product Spec provides CMP integration examples (OneTrust, Cookiebot, Osano) making correct consent handling a copy-paste operation. The `pending` mode with its 50-event, 30-minute queue ensures no events are lost while waiting for the user's choice.

### 5.7 Assuming Touch Events Guarantee Attribution

**What happens:** Client sees touch events in their dashboard and assumes attribution will follow automatically for any user who later converts.

**Why it happens:** The mental model is "click → track → convert → reward," and it feels like the SDK handles the first two steps completely.

**Why it's wrong:** Touch events are necessary but not sufficient. Attribution also requires: a conversion event from the backend with a linkable identity, conversion within the attribution window, active campaign, passing eligibility checks, and no fraud holds. A touch event with no subsequent conversion event produces no attribution.

**How the platform prevents it:** The referral lifecycle (Event Model Section 4.3) makes this explicit: referrals can expire, be rejected, or simply never convert. Dashboards show funnel drop-off at each stage. The Business Rules Guard (API Contract Section 5.7) provides immediate feedback at ingestion: expired links return `410`, paused campaigns conditionally accept events, and unknown campaigns return `422`.

### 5.8 Sending Events Long After They Occurred

**What happens:** Client batches conversion events and sends them days later with `occurred_at` set to the current time.

**Why it happens:** The developer doesn't persist the original timestamp and uses `new Date()` at send time.

**Why it's wrong:** Attribution window evaluation depends on `occurred_at`. A conversion that actually occurred within the 30-day window might be mis-classified as organic. Time-series analytics become unreliable.

**How the platform prevents it:** Touch events must have `occurred_at` within the last 7 days; conversion events within 30 days (API Contract Section 5.3). Future timestamps beyond 5-minute tolerance are rejected. The Event Model (Section 2.1) documents `occurred_at` as the business-significant timestamp, distinct from `ingested_at` (operational) and `processed_at` (pipeline).

### 5.9 Using API Keys for CRUD Operations

**What happens:** Client tries to create campaigns, manage rewards, or read analytics using their `rai_live_` secret key.

**Why it happens:** In the previous architecture assumption, API keys had broad access. The client's developer doesn't realize the authentication model has changed.

**Why it's wrong:** API keys — even secret keys — are restricted to event ingestion and SDK endpoints (API Contract Section 2.2). All CRUD operations require OAuth2 JWT authentication via dashboard sessions.

**How the platform prevents it:** Any API key request to a non-ingestion endpoint returns `403 authorization_error` with the message: "API keys are restricted to event ingestion and SDK endpoints. Use OAuth2 authentication for this resource."

### 5.10 Not Writing Referral Code to Payment Provider Metadata (Method B)

**What happens:** Client configures the Stripe webhook integration but forgets to write `refrev_ref_code` into `customer.metadata` at customer creation time.

**Why it happens:** The webhook side is automatic (platform reads from Stripe), but the metadata writing side requires client backend work.

**Why it's wrong:** The platform receives payment webhooks but cannot attribute them to any referral. Revenue appears in Stripe but not in referral attribution dashboards.

**How the platform prevents it:** The integration health dashboard surfaces "unattributed payments from connected billing provider" as a warning. Documentation for Method B (Product Spec Section 9) provides copy-paste code examples for writing metadata at customer creation.

---

*End of document.*
