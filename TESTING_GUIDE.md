# TESTING_GUIDE — Run & Write Tests for the Tenant & Billing Service

A beginner-friendly, **standalone** guide to testing this service. Everything here runs with **only
PostgreSQL + Redis** on your machine — no other microservices, no Ory, no real Stripe, no AWS. External
dependencies are mocked. If you can run `pnpm install`, you can run these tests.

> Related docs: [tenant-implementation.md](tenant-implementation.md) (what the service does),
> [TENANT_GUIDE.md](TENANT_GUIDE.md) (plain-language tour), [bdd-features.md](bdd-features.md) (BDD
> scenario reference), [billing_scenarios.md](billing_scenarios.md) (manual Stripe-mode billing checks).

## The two kinds of tests

| Type | Command | Needs infra? | What it covers |
|------|---------|--------------|----------------|
| **Unit** (Jest) | `pnpm test` | **No** — all dependencies mocked | One class at a time: services, guards, validators, helpers |
| **BDD** (Cucumber) | `pnpm test:bdd` | **Postgres + Redis** only | Real HTTP requests through the full app (guards, validation, DB) |

- **Unit tests** mock everything (DB, Redis, Stripe, …) with `jest-mock-extended`. They are fast and need
  zero services running. Use them for business logic.
- **BDD tests** boot the **real** NestJS app and make real HTTP calls with `supertest`. They use a real
  Postgres + Redis, but **mock the external network**: Ory JWKS + Keto via `nock`, and Stripe via a fake
  `StripeService`. That's why you don't need any other microservice to run them.

## One-time setup

```bash
# 1. Install dependencies (pnpm only)
pnpm install

# 2. Start Postgres + Redis (from the infra repo, or your own local instances)
#    Postgres on localhost:5432, Redis on localhost:6379
docker compose up -d postgres redis      # in the referralai-infra repo

# 3. Point the service at your DB — set DATABASE_URL in .env.development
#    e.g. postgresql://postgres:postgres@localhost:5432/tenants

# 4. Create the schema + load mock data
npx prisma generate                       # build the typed client
npx prisma migrate dev                    # apply the migration baseline (creates all tables)
npx prisma db seed                        # load mock data (see below)
```

That's it. Unit tests need nothing beyond `pnpm install`; BDD needs steps 2–4.

## What the seed gives you (mock data)

`npx prisma db seed` is idempotent and creates everything you need to exercise tenant + billing flows:

| Data | Values |
|------|--------|
| **Currencies** | USD, EUR |
| **Roles** | OWNER, ADMIN, MEMBER, VIEWER (each with scopes) |
| **Plans** | Free, Starter, Growth, Enterprise (with usage limits) |
| **Test tenant** | id `AZP-772-OMEGA` — use in the `x-tenant-id` header for manual calls |
| **Default tenant** | id `default-tenant` — the tenant the local Ory/dev JWT resolves to |
| **Billing rows** | a Free / no-subscription billing row for each seeded tenant |

You can re-run the seed any time. To wipe and rebuild from scratch:
`npx prisma migrate reset` (drops the DB, re-applies the baseline, reseeds).

## Running the suites

```bash
pnpm test                  # all unit tests
pnpm test:cov              # unit tests + coverage report
pnpm test -- subdomain     # only files matching "subdomain"

pnpm test:bdd              # all BDD scenarios (needs Postgres + Redis)
pnpm test:bdd:auth         # only @auth scenarios
pnpm test:bdd:billing      # only @billing scenarios
pnpm test:bdd:guards       # only @guards scenarios
pnpm test:bdd:dry          # parse scenarios without running (fast sanity check)
```

## How BDD runs with no other services

When the BDD suite boots the app, it intercepts every outbound network call so nothing external is
required (`test/bdd/support/`):

| External dependency | How it's faked | Where |
|---------------------|----------------|-------|
| Ory **JWKS** (token signing keys) | `nock` serves a test RSA public key; tests sign tokens with the matching private key | `nock.setup.ts`, `jwt.helper.ts` |
| Ory **Keto** (permission checks) | `nock` returns `{ allowed: true }` for every check (one helper flips it to deny) | `nock.setup.ts` |
| **Stripe** | `StripeService` is replaced with a fake returning canned checkout/preview responses | `stripe.fake.ts`, `app.bootstrap.ts` |
| **Postgres / Redis** | real (local) — not mocked | — |

So auth is **real** (real JWT signing + verification, real guards), only the *key source* and *permission
verdict* are stubbed. `api.stripe.com` is blocked in nock so a stray real Stripe call fails fast instead
of hanging.

## BDD fixtures & tags

Scenarios that need a tenant in a specific state add a tag; a hook creates the row before and deletes it
after (`hooks.ts` + `db.fixtures.ts`):

| Tag | Sets up |
|-----|---------|
| `@needs-suspended-tenant` | a tenant with `status = suspended` |
| `@needs-locked-tenant` | a tenant with `status = locked` |
| `@needs-active-tenant` | a tenant with `status = active` |
| `@needs-active-subscription` | gives `default-tenant` an active Starter subscription (for upgrade/preview) |
| `@public-endpoint` | (doc tag) the route is `@Public()` — no token needed |

Inside the scenario, `Given I have a valid JWT for the current fixture tenant` signs a token for whatever
tenant the tag created. Tokens are built by `jwt.helper.ts` (`makeActiveUserToken`, `makeExpiredToken`,
`makeServiceToken`).

## Writing a unit test

Mock the dependencies, test one class. Example shape (`*.spec.ts` next to the file under test):

```ts
import { Test } from '@nestjs/testing';
import { mock } from 'jest-mock-extended';
import { DatabaseService } from '@app/database/database.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { MyService } from './my.service';

describe('MyService', () => {
    let service: MyService;
    const prisma = mock<DatabaseService>();
    const logger = mock<AppLoggerService>();

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                MyService,
                { provide: DatabaseService, useValue: prisma },
                { provide: AppLoggerService, useValue: logger }
            ]
        }).compile();
        service = moduleRef.get(MyService);
    });

    it('does the thing', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ id: 't1', status: 'active' } as never);
        await expect(service.check('t1')).resolves.toBe(true);
    });
});
```

> Tip: every constructor dependency must be provided. A "Nest can't resolve dependencies … argument
> DateService" error means you forgot to add `{ provide: DateService, useValue: mock<DateService>() }`.

## Writing a BDD scenario

1. Add the scenario to a `.feature` file in `test/bdd/features/` (tag it if it needs a tenant state).
2. Reuse existing steps in `test/bdd/step-definitions/` (`common.steps.ts` has generic request/response
   steps). Add a new `Given/When/Then` only if no step fits.

```gherkin
@billing
Scenario: Usage summary returns metrics
  Given the application is running
  And I have a valid JWT for tenant "default-tenant"
  When I send a GET request to "/api/v1/billings/usage" with that token
  Then the response status should be 200
  And the response should contain a "metrics" field
```

## Testing a billing flow end-to-end (walkthrough)

Say you want to verify **subscription checkout**. With the seed loaded and the Stripe fake in place:

```gherkin
@billing
Scenario: Checkout returns a Stripe URL
  Given the application is running
  And I have a valid JWT for tenant "default-tenant"
  Given the Stripe checkout API is mocked to return a checkout URL
  When I send a POST request to "/api/v1/billings/subscription/checkout" with body:
    """
    { "plan": "Starter" }
    """
  Then the response status should be 200
  And the response should contain a "checkoutUrl" field
```

The request flows through: global `JwtAuthGuard` (verifies the test JWT) → `PermissionGuard` (Keto mock
allows) → `TenantStatusGuard` (default-tenant is active) → `BillingController` → `BillingService` →
the **fake** `StripeService` (returns a checkout URL). No real Stripe call happens.

To test an **upgrade preview** (needs an existing subscription), tag the scenario
`@needs-active-subscription` — the hook gives `default-tenant` an active Starter subscription so the
service has something to preview, and the fake returns the proration amount.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Nest can't resolve dependencies … DateService` (unit) | Add the missing provider mock to the test module. |
| BDD step times out at 30s on a Stripe call | A real Stripe call is happening — make sure the scenario goes through the faked `StripeService` (it's overridden in `app.bootstrap.ts`); never call `api.stripe.com` directly. |
| `401 Too many requests to the JWKS endpoint` | JWKS cache is off — the bootstrap sets `AUTH_CACHE_ENABLED=true`; don't override it to `false`. |
| `relation "..." does not exist` / empty results | Run `npx prisma migrate dev` then `npx prisma db seed`. |
| `403 TENANT_SUSPENDED/TENANT_LOCKED` unexpectedly | The tenant fixture is suspended/locked — check the scenario's `@needs-*` tag. |
| App won't boot in BDD | Postgres or Redis isn't running, or `DATABASE_URL` is wrong. |
| Want a clean DB | `npx prisma migrate reset` (drops, re-applies baseline, reseeds mock data). |

## Before you commit

```bash
pnpm build         # 0 issues
pnpm lint:check    # 0 errors (warnings are pre-existing, non-failing)
pnpm test          # unit suite green
pnpm test:bdd      # BDD suite green (needs Postgres + Redis)
```

