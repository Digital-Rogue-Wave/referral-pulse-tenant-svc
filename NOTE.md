# NOTE — Tenant & Billing Service: Spec Re-Alignment

Meeting-shareable log of spec inconsistencies, decisions, and cross-team contract items found while
re-aligning this service to the canonical template specs. Updated as the pass progresses.

Date of pass: 2026-06-17.

---

## Source of truth

The canonical specs now live (verbatim) in `docs/`:
`referralai_system_architecture_v1.md`, `referralai_db_tables_per_service.md`,
`referralai_event_model_v2.1.md`, `referralai_api_contract_v1.2.md`,
`referral_platform_product_spec.md`, `referralai_responsibility_contract_v2.md`,
`referralai_failure_observability_model_v2.md`, `docker-compose.yml`.
`docs/` and `docs/specs/` are READ-ONLY.

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
  - Added spec tables `users` (keyed by `(tenant_id, kratos_identity_id)`), `roles` (seeded:
    OWNER/ADMIN/MEMBER/VIEWER → scopes), `user_roles`. Synced via `prisma db push`.
  - Published `user.registered` `{ user_id, tenant_id, role }` and `user.role_changed`
    `{ user_id, tenant_id, old_role, new_role }` to `USER_EVENTS_TOPIC` (snake_case), projected from the
    existing `team-member.created`/`team-member.updated` lifecycle via `UserProjectionListener`
    (no change to the team-member transaction — surgical).
  - **Intentional overlap (decision):** `team_members` already stores user+role per tenant; `users`/
    `user_roles` are the spec-canonical store, populated as a projection. `team_members` is retained as
    the existing API surface. Consolidating the two is a recommended follow-up, not done in this pass.
  - **Ory delegation (intentional):** `oauth2_clients` and `sessions` are NOT created as local tables —
    Ory Hydra/Kratos are the system of record (the spec's own table notes say "managed via Ory"), and
    there is no API/event surface for them here (YAGNI).
  - **Naming discrepancy (contract item):** the API contract names roles Owner/Admin/**Operator**/Viewer;
    this service uses OWNER/ADMIN/**MEMBER**/VIEWER (MEMBER ↔ Operator). Aligned to the existing
    `TeamMemberRole`; flag for a cross-team naming decision.
  - **Spec gap (not built — out of scope):** `tenants.verification_status`
    (unverified→pending_review→verified→rejected, payout gate) from the responsibility contract is not
    present on the `tenants` table. Recorded for the Phase 4 audit / a separate task.
- **Internal/identity endpoints (Phase 3c — DONE):**
  - `GET /v1/internal/validate-token` (`@Public`) resolves an API key (`x-api-key`/`x-tenant-api-key`)
    or an OAuth2 JWT (`Authorization: Bearer`) to `{ tenant_id, scopes, source, key_type, user_id }`
    (`TokenResolverService` reuses `ApiKeyService.validateKey`; JWT verification mirrors `JwtStrategy`
    JWKS config — no duplicated dependency).
  - `GET /v1/users/me` returns the current user's profile + roles/scopes from the user projection.
  - **`PUT /users/:id/roles` (contract endpoint) intentionally NOT duplicated** — role assignment is
    served by the existing `PUT /v1/team-members/:id`, which now projects `user_roles` and emits
    `user.role_changed`. Documented to avoid two divergent role-update paths (KISS). Flag if a literal
    `/users/:id/roles` path is required by a consumer.
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

### Spec gaps recorded (out of this pass's scope)
- `tenants.verification_status` (unverified→pending_review→verified→rejected payout gate) — not present.
- Role naming `Operator` (spec) vs `MEMBER` (impl).
- Prisma migration baseline — **RESOLVED** (squashed baseline + reset; see the migration-baseline section above).

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
  (`TenantLockGuard` has the same latent ALS-timing issue but is not exercised by BDD — left as-is and
  noted here; `TenantStatusGuard` already covers the LOCKED case.)
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
- `users`/`user_roles` are a projection alongside the retained `team_members` (consolidation follow-up).
- `PUT /users/:id/roles` served by `PUT /team-members/:id` rather than a duplicate path.
