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
  → GET /billings/subscription, no token
  → 401

Scenario: Request with expired JWT is rejected
  → GET /billings/subscription, expired token
  → 401

Scenario: Request with malformed JWT is rejected
  → GET /billings/subscription, "not.a.valid.jwt.at.all"
  → 401

Scenario: Valid JWT for non-existent tenant returns 404
  → GET /billings/subscription, tenant "bdd-nonexistent-tenant-xyz"
  → 404, errorCode: TENANT_NOT_FOUND

Scenario: Active tenant with valid JWT can access the API
  → GET /billings/subscription, tenant "default-tenant"
  → not 401, not 403

Scenario: Public endpoint is accessible without any token  @public-endpoint
  → GET /billings/plans, no token
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
  → GET /billings/subscription
  → 200, body contains "plan" and "status"

Scenario: List public billing plans without authentication  @public-endpoint
  → GET /billings/plans, no token
  → 200, non-empty array, each item has "name"

Scenario: Create checkout session returns a Stripe URL
  → POST /billings/subscription/checkout  { "plan": "Starter" }
  → Stripe mocked (nock one-shot)
  → 200, body contains "checkoutUrl"

Scenario: Get usage summary returns usage metrics
  → GET /billings/usage
  → 200, body contains "metrics"

Scenario: Preview subscription upgrade returns 200
  → POST /billings/subscription/upgrade/preview  { "targetPlan": "Growth" }
  → 200
```

---

### `tenant-guards.feature` (5 scenarios) `@guards`

> Fixture tenants are created/destroyed per scenario via tagged hooks.

```gherkin
Scenario: Suspended tenant is blocked  @needs-suspended-tenant
  → GET /billings/subscription, JWT for bdd-suspended-001 (status: suspended)
  → 403, errorCode: TENANT_SUSPENDED, title: "Forbidden"

Scenario: Locked tenant is blocked  @needs-locked-tenant
  → GET /billings/subscription, JWT for bdd-locked-001 (status: locked)
  → 403, errorCode: TENANT_LOCKED

Scenario: Locked tenant error response has the correct shape  @needs-locked-tenant
  → GET /billings/subscription, JWT for bdd-locked-001
  → 403, response contains "title", "detail", "errorCode"

Scenario: Active tenant passes the tenant status guard  @needs-active-tenant
  → GET /billings/subscription, JWT for bdd-active-001 (status: active)
  → not 403

Scenario: Public endpoint bypasses tenant status guard  @public-endpoint
  → GET /billings/plans, no token
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
