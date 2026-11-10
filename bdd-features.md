# BDD Test Suite — referral-pulse-tenant-svc

**Stack:** `@cucumber/cucumber` v11 · TypeScript · supertest · nock  
**Scenarios:** 17 across 3 feature files  
**Coverage:** Authentication, Billing, Tenant Status Guards

---

## File Structure

```
test/bdd/
├── features/
│   ├── auth.feature
│   ├── billing.feature
│   └── tenant-guards.feature
├── step-definitions/
│   ├── common.steps.ts
│   ├── auth.steps.ts
│   ├── billing.steps.ts
│   └── tenant-guards.steps.ts
└── support/
    ├── world.ts           — shared scenario state (token, response, tenantId)
    ├── app.bootstrap.ts   — NestJS TestingModule, single boot per suite
    ├── jwt.helper.ts      — RSA-2048 key pair + token factories
    ├── nock.setup.ts      — HTTP interceptors (JWKS, Keto, Stripe)
    ├── db.fixtures.ts     — per-scenario DB fixture lifecycle
    └── hooks.ts           — BeforeAll / AfterAll / tagged Before/After

cucumber.cjs               — runner configuration
.env.test                  — test environment variables
```

---

## Key Design Decisions

**Real auth pipeline — no guard mocking.**  
`JwtAuthGuard`, `TenantStatusGuard`, `PermissionGuard`, and `AlsAuthInterceptor` run exactly as in production. The only mocked layer is outbound HTTP to services that don't exist in the local environment:

| Intercepted endpoint | Returns |
|---|---|
| `GET localhost:4444/.well-known/jwks.json` | Test RSA-2048 public key (JWKS format) |
| `POST localhost:4466/relation-tuples/check` | `{ allowed: true }` (persistent) |
| `POST api.stripe.com/v1/checkout/sessions` | Fake session (per-scenario, one-shot) |

**JWT validation is real.**  
A throw-away RSA key pair is generated at suite startup (`crypto.generateKeyPairSync`). Tokens are signed with the private key; `jwks-rsa` inside `JwtStrategy` validates them against the public key served by nock. `AUTH_CACHE_ENABLED=false` forces a JWKS fetch on every token so nock intercepts consistently.

**Database is real.**  
Tests run against the dev PostgreSQL instance. Fixture tenants (`bdd-suspended-001`, `bdd-locked-001`, `bdd-active-001`) are created before each tagged scenario and deleted after. Seeded tenants (`default-tenant`, `AZP-772-OMEGA`) are not modified.

**Suite boots once.**  
`NestJS TestingModule` is initialised in `BeforeAll` and shared across all scenarios. Teardown runs in `AfterAll`. Boot time is ~3–5 s; individual scenario execution is <500 ms.

---

## Scenarios

### `auth.feature` (7 scenarios) `@auth`

```gherkin
Scenario: Request without Authorization header is rejected
  → GET /billing/plan, no token
  → 401

Scenario: Request with expired JWT is rejected
  → GET /billing/plan, expired token
  → 401

Scenario: Request with malformed JWT is rejected
  → GET /billing/plan, "not.a.valid.jwt.at.all"
  → 401

Scenario: Valid JWT for non-existent tenant returns 404
  → GET /billing/plan, tenant "bdd-nonexistent-tenant-xyz"
  → 404, errorCode: TENANT_NOT_FOUND

Scenario: Active tenant with valid JWT can access the API
  → GET /billing/plan, tenant "default-tenant"
  → not 401, not 403

Scenario: Public endpoint is accessible without any token  @public-endpoint
  → GET /billing/plans, no token
  → 200, non-empty array

Scenario: Service token can access internal endpoint
  → GET /internal/tenants/default-tenant/status, client_credentials token
  → 200
```

---

### `billing.feature` (5 scenarios) `@billing`

> Background: valid JWT for `default-tenant` on all scenarios except the public one.

```gherkin
Scenario: Get current subscription returns plan data
  → GET /billing/plan
  → 200, body contains "plan" and "status"

Scenario: List public billing plans without authentication  @public-endpoint
  → GET /billing/plans, no token
  → 200, non-empty array, each item has "name"

Scenario: Create checkout session returns a Stripe URL
  → POST /billing/subscription/checkout  { "plan": "Starter" }
  → Stripe mocked (nock one-shot)
  → 200, body contains "checkoutUrl"

Scenario: Get usage summary returns usage metrics
  → GET /billing/usage
  → 200, body contains "metrics"

Scenario: Preview subscription upgrade returns 200
  → POST /billing/subscription/upgrade/preview  { "targetPlan": "Growth" }
  → 200
```

---

### `billing-plan-change.feature` (8 scenarios) `@billing-plan-change` — US1.8.2

> Each scenario signs a fresh company up (reusing the `@billing-plan` steps and clean-up) and, where
> needed, puts it on a live `Growth` subscription in the database. Stripe's API is the BDD fake
> (`stripe.fake.ts`); Stripe's webhooks are signed for real and posted to `/api/webhooks/stripe`.

```gherkin
Scenario: A company that already pays cannot open a second subscription      → 409 state_conflict
Scenario: Free needs no checkout, and Enterprise is sold by sales            → 400 twice
Scenario: An upgrade can only go up                                          → 400, Stripe not called
Scenario: The plan changes when Stripe confirms the upgrade, not before      → 202 still Growth; webhook → Scale
Scenario: A declined card is a 402 with Stripe's message, not a 500          → 402 card_declined, plan unchanged
Scenario: Paying a late invoice in Stripe's current shape restores the company → payment status active
Scenario: When the subscription ends, the company is Free and owes nothing   → Free|canceled, active, audit row by system
Scenario: The embedded card-form routes are gone                             → 404
```

Run alone: `pnpm test:bdd --tags @billing-plan-change`.

---

### `invoice-history.feature` (5 scenarios) `@invoice-history` — US1.8.3

> Each scenario signs a fresh company up (reusing the `@billing-plan` steps and clean-up). Stripe's invoices are
> set in Stripe's own shape (cents) in `stripe.fake.ts` and read through the **real** `StripeService` mapping over
> an offline SDK, so the amounts and links checked are the ones the Owner receives.

```gherkin
Scenario: A company that has never paid has no invoices, and Stripe is not asked → 200, empty page
Scenario: Amounts are integers in minor units, as the API contract requires        → amount_due 4950, eur, PDF + hosted links
Scenario: The list is paged with Stripe's cursors                                  → 2 of 3, has_more, next_cursor in_bdd_2
Scenario: The next invoice is in minor units too                                   → amount_due 990, eur
Scenario: A member without billing:read cannot see the invoices                    → 403
```

Run alone: `pnpm test:bdd --tags @invoice-history`.

---

### `audit-trail.feature` (4 scenarios) `@audit-trail` — US1.9.1

> Each scenario signs a fresh company up (reusing the `@billing-plan` steps and clean-up). Actions go through the
> real HTTP stack; the append-only trigger is exercised straight on the database.

```gherkin
Scenario: A settings change leaves one audit row: who, before, after and the request id → by the Owner, EUR → USD, X-Request-Id
Scenario: A refused change leaves no audit row                                         → 403, no row
Scenario: The database refuses to change or delete an audit row                        → "append-only: UPDATE/DELETE refused"
Scenario: Only a transaction that opts in, like the retention sweep, can delete audit rows → rows gone
```

Run alone: `pnpm test:bdd --tags @audit-trail`.

---

### `audit-log-read.feature` (5 scenarios) `@audit-log-read` — US1.9.2

> Each scenario signs a fresh company up (reusing the `@billing-plan` steps and clean-up), changes its currency
> twice through the API, and reads `GET /api/v1/audit-log` against the real Postgres (F3: a mocked unit test hid
> the `deletedAt` 500).

```gherkin
Scenario: The Owner reads the trail, newest first, without the IP hash → tenant_setting.updated EUR → USD first, no ip_hash
Scenario: Filters narrow the trail                                    → action=tenant_setting.created: 1 entry
Scenario: The trail is paged with cursors                             → limit=1, has_more, next page older
Scenario: Another company's entries never show                        → 0 entries
Scenario: Only the Owner may read it                                  → 403 without audit:read
```

Run alone: `pnpm test:bdd --tags @audit-log-read`.

---

### `tenant-guards.feature` (5 scenarios) `@guards`

> Fixture tenants are created/destroyed per scenario via tagged hooks.

```gherkin
Scenario: Suspended tenant is blocked  @needs-suspended-tenant
  → GET /billing/plan, JWT for bdd-suspended-001 (status: suspended)
  → 403, errorCode: TENANT_SUSPENDED, title: "Forbidden"

Scenario: Locked tenant is blocked  @needs-locked-tenant
  → GET /billing/plan, JWT for bdd-locked-001 (status: locked)
  → 403, errorCode: TENANT_LOCKED

Scenario: Locked tenant error response has the correct shape  @needs-locked-tenant
  → GET /billing/plan, JWT for bdd-locked-001
  → 403, response contains "title", "detail", "errorCode"

Scenario: Active tenant passes the tenant status guard  @needs-active-tenant
  → GET /billing/plan, JWT for bdd-active-001 (status: active)
  → not 403

Scenario: Public endpoint bypasses tenant status guard  @public-endpoint
  → GET /billing/plans, no token
  → 200
```

---

## Running the Suite

> **Requirements:** PostgreSQL `localhost:5432` (db: `tenants`) · Redis `localhost:6379`

```bash
# Parse only — no execution, no DB required
pnpm test:bdd:dry

# By feature
pnpm test:bdd:auth
pnpm test:bdd:billing
pnpm test:bdd:guards

# Full suite
pnpm test:bdd
```

**Output:** console via `@cucumber/pretty-formatter` + JSON report at `test/bdd/reports/cucumber-report.json`.

---

## Traceability

| Requirement | Feature | Scenario |
|---|---|---|
| Unauthenticated requests blocked | auth | No token → 401 |
| Expired tokens rejected | auth | Expired JWT → 401 |
| Invalid tokens rejected | auth | Malformed JWT → 401 |
| Non-existent tenant returns 404 | auth | Non-existent tenant → 404 TENANT_NOT_FOUND |
| Authenticated access works | auth | Active tenant → not 401/403 |
| Public endpoints require no auth | auth, billing, guards | @public-endpoint scenarios |
| M2M service tokens supported | auth | Service token → 200 |
| Subscription data accessible | billing | GET subscription → 200 |
| Checkout session creation | billing | POST checkout → checkoutUrl |
| Usage tracking accessible | billing | GET usage → 200 |
| Suspended accounts blocked | guards | Suspended → 403 TENANT_SUSPENDED |
| Locked accounts blocked | guards | Locked → 403 TENANT_LOCKED |
| Active accounts allowed through | guards | Active → not 403 |
| Error response shape compliant | guards | Locked error shape |
