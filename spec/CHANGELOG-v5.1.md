# Spec corrections for v5.1

**What this is.** Every contradiction, gap and impossibility found in the v5.0 suite while aligning
the four services in this working set — Event Ingestion, Identity & Access (tenant), Analytics and
Notifications — against it. One entry per defect, grouped by the document that needs the edit, with
the evidence, what the implementation did instead, and the proposed correction.

**What this is not.** The v5.0 HTML documents in `spec/` are the lead's source of truth and are not
edited by this file. This is the patch list to apply to them.

**How to read an entry.** *Says* is what the suite states today, quoted or closely paraphrased.
*Against* is the statement it contradicts. *Built* is what the code does, and where the reasoning is
recorded. *Fix* is the proposed edit.

**Status of each.** Nothing here is blocked on a decision: every one was resolved in code, under a
recorded decision with its rejected alternative. The edits are so the next reader of the spec reaches
the same answer without re-deriving it.

| Scope | Count |
|---|---|
| Product Spec | 6 |
| API Contract | 6 |
| Event Model | 8 |
| DB Model | 8 |
| Architecture | 6 |
| **Total** | **34** |

Service NOTE.md files hold the full reasoning: `referral-pulse-event-svc/NOTE.md` §11,
`referral-pulse-tenant-svc/NOTE.md` §V5, `referral-pulse-analytics-svc/NOTE.md` §A5,
`referral-pulse-notification-svc/NOTE.md` §N5. `referral-pulse-event-svc/NOTE.md` §11 is also the
cross-service decision list.

---

## Product Specification

### D-01 · R-CPL-01's "Event Model compliance family" is not in the Event Model

- **Says** R-CPL-01 cites "Event Model compliance family (`consent.recorded`, `dsr.requested`,
  `erasure.completed`, `audit.logged`)".
- **Against** The Event Model defines none of the four — no payload, no `object_type`, no schema
  version. They appear only in the Product Spec (2, 3, 4 and 3 mentions). The Event Model's own
  revision note lists §5.6–§5.10, which would have held them, as "Still to author".
- **Built** tenant-service publishes all four with payloads derived from what R-CPL-02 says each has
  to carry (`NOTE.md` §V5.16 D5-13/D5-14).
- **Fix** Author §5.10 with the four shapes, or state in R-CPL-01 that the family is forthcoming so
  the citation does not read as a reference to something that exists.

### D-02 · R-CPL-02 specifies a fan-out for erasure only

- **Says** "A DSR (access, erasure, portability) is submitted by the Owner through `POST /v1/dsr`",
  then gives a fan-out, a receipt and a completion event for **erasure** alone.
- **Against** Its own sentence promises three request types. Access and portability get no collect
  contract, no response format and no per-service shape.
- **Built** Erasure runs end to end; access and portability are recorded, dated against the legal
  deadline and answerable at `GET /v1/dsr/{id}`, resting at `accepted` (§V5.16 D5-8). Inventing six
  "collect my share" contracts was rejected.
- **Fix** Either specify the access/portability fan-out, or say explicitly that V1 executes erasure
  and logs the other two.

### D-03 · No document specifies the erasure handler every service must implement

- **Says** R-CPL-01: "every other service implements its own erasure handler and returns a receipt."
  R-CPL-02 lists what each of the six erases.
- **Against** No path, no request body and no receipt shape appear anywhere in the suite — for a
  contract six services have to implement identically and a seventh has to call.
- **Built** `POST {base}/api/v1/internal/erasures/subjects`, snake_case body
  `{dsr_id, tenant_id, participant_id?, user_id?, subject_email_hash?}`, receipt
  `{dsr_id, service, status, erased, retained[], processed_at}`. Not invented: analytics-service and
  notification-service had already implemented exactly this, and tenant-service's fan-out was
  corrected to match (§V5.17).
- **Fix** Add the contract to the API Contract as an internal endpoint, with the request and receipt
  shapes.

### D-04 · The erasure contract has no field for the client's own subject identifier

- **Says** `POST /v1/dsr` can name a subject by email, by the platform's participant id, or by the
  client's own external id.
- **Against** The handler contract (D-03) accepts only the first two. A DSR submitted with just an
  external id is unexecutable everywhere.
- **Built** `ErasureClient` does not make the call at all and records a `pending` receipt saying why,
  rather than sending five requests to be refused (§V5.17 D5-16).
- **Fix** One optional `subject_external_id` on the handler contract. The identity the Owner has is
  not always the identity the services hold.

### D-05 · §13's Analytics row omits four endpoints Analytics owns

- **Says** §13 "API Surface Ownership" gives Analytics `GET /v1/analytics/*`, `GET /v1/attributions`
  and `GET /v1/programs/{id}/health`.
- **Against** API Contract §3.2, §3.3, §3.6 and §3.7 give `GET /v1/campaigns/{id}/stats`,
  `/v1/variants/{id}/stats`, `/v1/referrers/{id}/stats` and `GET /v1/events` the `analytics:read`
  permission, and the Architecture's analytics row lists `GET /v1/variants/{id}/stats` among its own
  Sync APIs. Read on its own, §13 routes four of analytics-service's endpoints to other services.
- **Built** All four are served by analytics-service (`NOTE.md` A5.7). No route moved; the gateway
  rules are written out in `my-docs/cross-service-requirements.md` §5.1.
- **Fix** Add the four to the Analytics row.

### D-06 · §13 lists whole prefixes, but five prefixes are split between two services

- **Says** One owning domain per surface.
- **Against** `/v1/campaigns/*`, `/v1/variants/*`, `/v1/referrers/*`, `/v1/programs/*` and
  `/v1/events` each have one or two paths owned by a *different* service than the prefix, and
  `/v1/analytics/*` is Analytics' except `POST /query` and `GET /insights`, which are ai-service's.
  Only the per-endpoint permission reveals it.
- **Built** Every endpoint is on its contract path; the split is a gateway rule
  (`my-docs/cross-service-requirements.md` §5.1).
- **Fix** One column on the §13 table — "exceptions under this prefix" — or a separate routing table.
  Without it a gateway configured from §13 alone breaks nine working endpoints.

---

## API Contract

### D-07 · API keys cannot be both bcrypt-hashed and looked up by hash

- **Says** §2: "API keys are bcrypt-hashed". DB Model §3: `key_hash text not null (bcrypt/argon2 of
  full key)` with `Unique: (key_hash)`.
- **Against** bcrypt and argon2 are salted, so the digest is not reproducible from the presented key.
  A unique index on it can never be probed and validation would have to scan every row and verify
  each one.
- **Built** HMAC-SHA256 with a server-side pepper: deterministic, indexable, still non-reversible
  (tenant `NOTE.md` §V5.5 #3).
- **Fix** Say *keyed hash* (HMAC with a server-side pepper), not bcrypt. The §2 sentence and the DB
  Model column comment both.

### D-08 · The §2 namespace table says `participants`; everywhere else says `referrers`

- **Says** §2's Keto namespace table lists `participants`.
- **Against** Every other mention, including the per-endpoint permissions, says `referrers`.
- **Built** `referrers` (tenant decision T-2). A namespace is an exact string, so the other spelling
  produces tuples nothing ever checks.
- **Fix** One word in the table.

### D-09 · `POST /v1/dsr` is gated on a permission that is not about data-subject requests

- **Says** §3.15's table: `POST /v1/dsr` → `referrers:write`, `GET /v1/dsr/{id}` → `referrers:read`.
  Its own revision line: "Owner-only — permission to update to `programs:write`".
- **Against** The two disagree, and neither candidate is about data-subject requests. Gating a DSR on
  a *programs* or *participants* permission reads as a copy-paste.
- **Built** `dsr:manage`, added to the permission catalogue and the Keto namespaces. All three resolve
  to Owner-only today, so effective access is identical; a separate permission is what later lets a
  compliance officer answer DSRs without being able to edit participants or programs (§V5.16 D5-11).
- **Fix** `dsr:manage` in the table, and drop the revision line's suggestion.

### D-10 · §3.15 and R-CPL-02 state one deadline two ways

- **Says** §3.15: "Processed within 30 days". R-CPL-02: "within the client's legal deadline (one
  month)".
- **Against** Not a contradiction, but an implementer has to pick, and "one month" is not a number of
  days.
- **Built** 30 days, stamped on `dsr_requests.due_at` at submission (§V5.16 D5-12).
- **Fix** One of the two, consistently. If the deadline is meant to be tenant-configurable, say so —
  nothing in the suite provides for that today.

### D-11 · §6.5's revision line and its own table disagree on the provider list

- **Says** The revision names `stripe, paddle, chargebee, paypal, wise, tremendous`. The table
  directly below lists Stripe, Paddle, Chargebee, PayPal/Wise, "Gift-card (Tremendous/Tango)" and
  "CRM (HubSpot/Salesforce)".
- **Against** The revision swaps a category for one vendor inside it and drops CRM entirely. DB Model
  §10's CHECK is `('stripe','paddle','chargebee','paypal','wise','gift_card','crm')`.
- **Built** The category list, matching the CHECK (tenant `NOTE.md` §V5.13 D4-3).
- **Fix** Align the revision line with the table and the CHECK.

### D-12 · Two endpoint families are still unauthored, and one of them blocks email tracking

- **Says** "Still to author: `POST /v1/sdk/invitations` (§4)". The Event Model: "Still to author …
  invitation events `invitation.sent|bounced`".
- **Against** `event.email.opened` and `event.email.clicked` both make `invitation_id` **required**,
  and the Event Model says the token is "authenticated by the token the notification service signed
  at send time". With neither the endpoint nor the event, nothing creates an invitation and nothing
  tells notification-service to send one — so platform-sent invitations have **no open or click
  tracking at all**, which is the email family the whole `/t/o` + `/t/c` mechanism exists for.
- **Built** Both ends are ready: notification-service signs the tokens and ingestion verifies them,
  sharing one verbatim-copied payload contract (notification `NOTE.md` §N5.8, ingestion §11.12).
  What is missing is one route-table entry.
- **Fix** Author either, with `invitation_id` and `referral_code` on the event.

---

## Event Model

### D-13 · The compliance family has no section

See **D-01**. §5.6–§5.10 are marked "Still to author", and §5.10 is where the four compliance events
belong.

### D-14 · R-CPL-02's "carries all receipts" and §2.5's flat-properties rule cannot both be met literally

- **Says** §2.5: `properties` is a flat object of primitives. R-CPL-02: `erasure.completed` "carries
  all receipts".
- **Against** A list of per-service receipts is not a primitive.
- **Built** Every receipt travels as one JSON **string** property, with `receipt_count` and
  `retained_under_obligation` alongside for consumers that only need the summary, and the per-service
  detail readable at `GET /v1/dsr/{id}` (§V5.16 D5-13).
- **Fix** State which rule wins for this event, or define the flat shape.

### D-15 · "Ten event_names" against "twelve tracked events"

- **Says** §3.1 and §4's grouping say ten `event_name`s; the §4 header and §4.11/§4.12 say twelve
  tracked events.
- **Built** Twelve (ingestion `NOTE.md` §9.4 / B-1).
- **Fix** One count.

### D-16 · Two referenced schema files do not exist, under a third naming convention

- **Says** §4 references schema files for two events.
- **Against** The eleven `event.*.schema.json` files in `spec/` do not include them, and the names
  referenced follow a different convention than the eleven that are there.
- **Built** The eleven were regenerated and enforced; the two missing ones are unenforced (§9.4).
- **Fix** Add the two files, or drop the references.

### D-17 · `subscription.cancelled` is defined twice, in two classes

- **Says** §4.12 defines it as a conversion-class event; §4.10 uses it as a custom-event example.
- **Against** A tracked event is in exactly one class (R-CON-03), and the class decides the trust
  boundary and the retention rule.
- **Built** Conversion class (§9.4).
- **Fix** Remove the §4.10 example or rename it.

### D-18 · §8.2 does not say that renaming an `event_type` is a breaking change

- **Says** §8.2's compatibility rules cover `properties` under `schema_version`, and explicitly
  exempt the envelope.
- **Against** `event_type` lives in the envelope and is the routing key of every stored projection.
  Renaming the touch events in this revision silently broke two analytics projections in opposite
  directions — a failure migration 014 had predicted in its own header a year earlier.
- **Built** Re-created materialized views, aliases removed (analytics `NOTE.md` §A5.1, §A5.6).
- **Fix** State that a rename of an `event_name` / `event_type` carries the same ceremony as a schema
  change, because every stored projection keys on it.

### D-19 · §2.4's consent block has four fields; the ingestion request has one

- **Says** §2.4 defines `consent.tracking_consent` (required on tracked events),
  `marketing_consent`, `consent_source` and `consent_recorded_at`.
- **Against** API Contract §5.1's event body has a single `consent_status`, which maps to
  `tracking_consent`. Nothing on the wire carries the other three, so they are never populated.
- **Built** Ingestion publishes `tracking_consent` only; tenant-service's consent registry records
  null for the rest and falls back to the event's own time for `recorded_at` (§V5.16 D5-7).
- **Fix** Either add the three to the §5.1 request body, or mark them as populated by a source other
  than touch ingestion and say which.

### D-20 · Consent is "a field on touch events, not a standalone resource", and also a registry someone has to own

- **Says** API Contract §3.15: "Consent is a field on touch events (captured from CMP by JS SDK),
  **not a standalone resource**." R-CPL-01: "the Tenant service hosts the consent registry".
- **Against** There is no endpoint through which a registry could be written, and tenant-service is
  not in the touch path.
- **Built** tenant-service consumes touch events off the bus and records a row only when the signal
  changes (§V5.16 D5-7). This is also why Architecture §2.1's "Consumes: None" is now wrong (D-30).
- **Fix** Say how the registry is fed. Reading the bus is the only mechanism the suite leaves open.

---

## DB Model

### D-21 · §10 and Architecture §2.8 disagree about who hosts the inbound receivers

- **Says** DB Model §10 assigns notification-service the receivers, `inbound_webhook_receipts`, the
  `inbounddedup:{integration_id}:{provider_event_id}` Redis key and the relay into ingestion.
- **Against** Architecture §2.4 gives the receivers to Event Ingestion, and §2.8 makes
  notification-service outbound only — "it must never call ingestion".
- **Built** Receivers in ingestion (`/inbound/{provider}/{connection_id}`), and the three paths were
  removed from notification-service (ingestion §11.11, notification §N5.7). The Architecture is the
  revised document; the DB Model was not revised with it.
- **Fix** Move §10's receiver rows to the Event Ingestion section.

### D-22 · `inbound_webhook_receipts` has no author in the suite as written

- **Says** §10 and §13's matrix put the table in `notification_db`. Failure §4.3's
  Billing-to-Platform reconciliation reads it.
- **Against** Architecture §2.4 gives ingestion no RDS at all, and §2.8 stops notification seeing the
  callbacks. So no service can write it.
- **Built** Ingestion was given a database for exactly this plus its outbox, and writes the receipt
  itself (ingestion `NOTE.md` §11.14). Provider callbacks were being recorded before the receivers
  moved and would otherwise have stopped.
- **Fix** Resolve with D-21 and D-23: either give ingestion the table, or have it publish a
  payload-less receipt event that notification writes from the bus.

### D-23 · Architecture §2.4 says ingestion is stateless; ingestion needs an inbox and an outbox

- **Says** §2.4 / §12.1: Event Ingestion is stateless, Redis only, "nothing persists".
- **Against** A provider callback must be deduplicated durably (a Redis key is not a receipt), and a
  touch accepted with 202 must not be lost if SNS is unavailable at that instant.
- **Built** `ingestion_db` with `inbound_webhook_receipts` and `event_outbox` (DB Model §0.6 shape),
  a relay worker, and a receipt written in the same transaction as the outbox row (§11.14).
  Confirmed verbally by the lead as the intended design.
- **Fix** Say that ingestion owns a small store for the inbox and the outbox, and keep "stateless" for
  the read path (widget-config and resolve-link read Redis projections).

### D-24 · §13 gives ingestion no inbound dedup key

- **Says** Ingestion's Redis row is "dedup, touch dedup, 3× rate-limit, campaign cache, code mirror,
  session map"; the inbound dedup key is in notification's row.
- **Against** Ingestion hosts the receivers.
- **Built** Ingestion holds the claim key and the receipt (§11.14).
- **Fix** Mechanical consequence of D-21; move the key with the receivers.

### D-25 · §3 has no compliance tables, while R-CPL-01 assigns tenant-service three compliance responsibilities

- **Says** R-CPL-01 gives tenant-service the consent registry, the DSR endpoint, the DSR fan-out and
  the audit sink. DB Model §3 lists nine tables for the service, none of them a consent registry, a
  DSR request or a receipt.
- **Built** `consents`, `dsr_requests`, `dsr_receipts`, shapes derived from the prose that assigns the
  responsibility (§V5.12).
- **Fix** Add the three to §3.

### D-26 · §0.1's dual-key rule is followed by no table in the fleet

- **Says** §0.1 specifies `bigint pk` + ULID `id`.
- **Against** The 2026-09-02 platform ruling made ULID the single key, and every table in all four
  services is single-key ULID.
- **Built** Single-key ULID throughout, including the three new compliance tables — three dual-key
  tables in a single-key schema would be worse than consistent ones (§V5.12).
- **Fix** Replace §0.1 with the single-key ULID rule, and note the accepted trade (wider keys and
  string compare, in exchange for one id format on the wire).

### D-27 · §9 and the Architecture's revision header disagree on who computes the Program Health Score

- **Says** DB Model §9 lists "Program Health Score computation" among analytics-service's
  responsibilities. The Architecture's revision header says the score is "computed by **ai-service
  only**, stored in analytics_db".
- **Against** Either analytics computes it or it is a passive store. Two writers on a table upserted
  on `(tenant, program, date)` would silently overwrite each other.
- **Built** Both, selected by `HEALTH_SCORE_COMPUTE_ENABLED` (default on): analytics computes until
  ai-service exists, then the flag goes false and the same `GET /v1/programs/{id}/health` serves
  whatever ai-service wrote (analytics `NOTE.md` A5-13).
- **Fix** Say which, and say that the store and the endpoint are analytics' either way.

### D-28 · Company verification has two different state sets

- **Says** Architecture §2.1: the `account_verification` workflow runs
  `unverified → pending_review → verified → rejected`. DB Model §3 types
  `tenant_verifications.status` as `('pending','in_review','verified','rejected')`.
- **Against** `pending_review` vs `in_review`, and the DB has no `unverified` state while `tenants`
  `verification_status` does.
- **Fix** One set, in both documents.

---

## Architecture

### D-29 · §2.1 says tenant-service consumes nothing

- **Says** §2.1: "Consumes: None. It is a dependency of other services (token validation), not an
  event reactor."
- **Against** The Product Spec says it consumes "erasure receipts from every service", R-CPL-01 makes
  it the DSR coordinator, and R-CPL-01 + API §3.15 together mean the consent registry can only be fed
  from the bus (D-20).
- **Built** tenant-service now consumes its own inbound queue for consent (§V5.16 D5-7). Erasure
  receipts arrive as HTTP responses to the fan-out rather than as events, which is a reading the
  suite permits — but the sentence is still false.
- **Fix** Replace with what it consumes.

### D-30 · `X-Gateway-Secret` appears nowhere in the suite, and §12.1 and §13.1 read differently

- **Says** §13.1: "The ALB + Traefik + NestJS Auth Guard calls Tenant's `GET /internal/validate-token`",
  and credentials are "resolved once, at the edge". §12.1 gives Event Ingestion's guards as
  `auth → internal JWT (validate-token)` and names "the Tenant token call" among its own integration
  adapters.
- **Against** On one reading ingestion never validates a key; on the other it calls the exchange
  itself. tenant-service gated the endpoint on an `X-Gateway-Secret` that **no v5 document mentions**,
  which locked out the caller §12.1 names — every SDK and backend event answered 401.
- **Built** The two readings are the same thing: the auth guard is *part of* the gateway composite the
  system map labels "ALB + Traefik + NestJS Auth Guard". The endpoint now accepts either proof — the
  gateway's secret, or a service token holding `token_exchange.call`, held by `ingestion-svc` only
  (ingestion §11.16, tenant §V5.16).
- **Fix** Say that a service may call the exchange and how it proves itself; `X-Gateway-Secret` is an
  implementation detail that should be named or dropped.

### D-31 · The erasure handler is authorized three different ways

- **Says** R-CPL-01: every service implements its own erasure handler.
- **Against** The suite names neither the path nor the authorization mechanism, so each service chose:
  tenant- and notification-service authorize on the Keto capability `services:dsr.erase#call`,
  analytics-service on the token's `dsr.erase` **scope**, and the paths differ by subject type
  (`/erasures/subjects` vs `/erasures/operators`).
- **Built** The orchestrator satisfies all of them at once: it holds the Keto grant *and* requests the
  scope, since Hydra only issues scopes a client is registered for (§V5.17 D5-15).
- **Fix** State the mechanism once. Keto is the fleet's own rule — "scope is deliberately not used for
  authorization" — so analytics-service is the one to converge.

### D-32 · §2.3 still lists `conversion.recorded` under segmentation's Publishes

- **Says** §2.3's segmentation row publishes `conversion.recorded`.
- **Against** The same document's revision header says "segmentation-service no longer emits a
  translated `conversion.recorded`", and Event Model §4.12 says the translation does not happen.
- **Fix** Drop the row. A contradiction inside one document.

### D-33 · The email-tracking endpoint paths differ between documents

- **Says** §2.8's addendum: `/t/o`, `/t/c`, hosted by ingestion.
- **Against** notification-service implemented `/v1/track/open/:deliveryId/:token` and
  `/v1/track/click/:deliveryId`, and nothing says whether the delivery id stays in the path or moves
  inside the signed token.
- **Built** `/t/o/{token}` and `/t/c/{token}` at ingestion, version-neutral and outside the API
  prefix, with everything inside the signature — including the destination, so `/t/c` cannot be an
  open redirect (ingestion §11.12). The old notification routes are gone (§N5.7).
- **Fix** Record the canonical paths and that the token carries the whole payload.

### D-34 · Nothing specifies what the email-tracking token contains

- **Says** API Contract §6.5: "the token is signed by the notification service" and verified by
  ingestion. Architecture §2.1: the key belongs to tenant-service.
- **Against** Three services depend on one token shape and no document gives it.
- **Built** A shared contract file, byte-identical in both repos and tested identically in both:
  `base64url(payload).base64url(HMAC-SHA256(key, base64url(payload)))`, payload
  `{v, t, c, n, k?, u?, m?, i}` carrying exactly the fields the two email event schemas require
  (notification §N5.8 N5-9, ingestion §11.12).
- **Fix** Publish the payload shape in the API Contract or the Event Model, so a third implementer
  does not have to read two repos to find it.

---

## Not a defect, but worth an edit

- **`spec/` carries a `docker-compose.yml`** in two of the four repos. It is not part of the suite and
  looks like a stray copy.
- **The Event Model's `event._defs.schema.json` has no `consent` definition**, although §2.4 defines
  the block and every tracked-event schema would reference it. Adding it would make D-19 enforceable
  rather than prose.
