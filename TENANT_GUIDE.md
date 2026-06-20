# TENANT_GUIDE — A Plain-Language Tour of the Tenant & Billing Service

New to this service? Start here. This is the friendly, big-picture walkthrough — no deep code. For the
full technical reference see [tenant-implementation.md](tenant-implementation.md); for decisions and
cross-team notes see [NOTE.md](NOTE.md).

## What this service does (in one breath)

It answers two questions for the whole platform:
1. **"Who are you, and what are you allowed to do?"** — companies (tenants), their people (users), their
   roles, and their API keys.
2. **"Are you paid up?"** — subscription plans, Stripe billing, usage limits, and what happens when a
   payment fails.

Think of it as the **front door + the cash register** of the platform.

## Where it sits

Other microservices (campaign, referral, reward, analytics, …) all trust this service to tell them which
tenant a request belongs to and what it's allowed to do. They never store users or API keys themselves —
they ask us. We are a *dependency* of everyone, and we react to almost nobody (we mostly **publish**
facts, we don't consume other services' events).

## The cast of characters

| Term | Plain meaning |
|---|---|
| **Tenant** | A customer company/account. Everything else hangs off a tenant. The isolation boundary. |
| **User** | A person who logs in (an operator). Their login/password lives in **Ory** (Kratos); we keep a local record keyed to their Ory identity. |
| **Role** | A named bundle of permissions (OWNER, ADMIN, OPERATOR, VIEWER) → a list of "scopes". |
| **User (operator)** | A person who belongs to a tenant with a role. Stored in `users` (membership + role); their login lives in Ory. |
| **API key** | A secret a tenant's backend uses to call the platform's APIs. We store only a hash + a short prefix, never the raw key. |
| **Plan** | A subscription tier (Free/Starter/Growth/Enterprise) with usage limits. |
| **Billing** | A tenant's subscription state with Stripe (customer, subscription, payment status). |

## Where the data lives

Everything is in **PostgreSQL** (via Prisma). The main tables: `tenants`, `users`, `roles`,
`user_roles`, `api_keys`, `invitations`, `tenant_settings`, plus the billing tables
(`plans`, `billings`, `billing_events`, `tenant_usages`). Login credentials and sessions are **not** in
our database — those live in **Ory** (Kratos/Hydra/Keto). We keep a lightweight `users` projection that
points back to the Ory identity.

> Heads-up for newcomers: the dev database is kept in sync with `npx prisma db push` (not migrations) —
> the migrations folder is currently behind the schema. See [NOTE.md](NOTE.md).

## The main flows

### 1. A company joins
A tenant record is created. The first person becomes a **user** with the OWNER role. Behind the
scenes that also creates their `users` row + role assignment and announces `user.registered` to the rest
of the platform.

### 2. Inviting teammates
An OWNER/ADMIN sends an **invitation**. When accepted, a new user (membership + role) is created
with the chosen role. Changing someone's role announces `user.role_changed`.

### 3. Creating an API key
A tenant generates an API key for their backend. We show the raw key **once**, then store only its hash
and a short prefix. Creating one announces `api_key.created`; revoking (deleting) it announces
`api_key.revoked`. Keys have a `key_type` (`secret` or `publishable`) and a set of scopes.

### 4. Every API call, everywhere
When any request hits the platform, the gateway/guard calls our **`GET /internal/validate-token`**.
We take the credential (an API key *or* an OAuth2 JWT), check it, and hand back a tidy answer:
`{ tenant_id, scopes, source, key_type, user_id }`. That's how every other service knows who's calling.

### 5. Subscribing & paying (the cash register)
A tenant picks a plan and checks out via **Stripe**. Stripe then sends us **webhooks** as payments
succeed or fail. We track usage against plan limits.

### 6. When a payment fails (escalation)
If a payment fails, the tenant doesn't get cut off instantly. It escalates over time:
**PAST_DUE → RESTRICTED → LOCKED**. Each step announces an event (`payment.failed`, `tenant.restricted`,
`tenant.locked`) so other services can react (e.g. stop serving). Pay up and it flips back to ACTIVE
(`payment.restored`, `tenant.restored`). This runs as a scheduled background job.

## How permissions work (the short version)

- **Logging in / identity** → Ory **Kratos**.
- **Issuing tokens (OAuth2)** → Ory **Hydra**.
- **Checking "can this user do X?"** → Ory **Keto** (our `PermissionGuard` asks Keto on protected routes).
- **Roles → scopes** live in our `roles` table and flow through `/users/me` and `/internal/validate-token`.

## How news travels (events)

When something important happens, we **emit a domain event after the database commit**, and a broadcaster
publishes it to an **SNS topic** that other services subscribe to (`user-events-topic`,
`billing-events-topic`). Internally we use camelCase; on the wire we use the spec's snake_case. Audit
copies go to a dedicated audit queue.

## Billing is here on purpose

The platform's master spec actually puts billing in *other* services. In this codebase, billing lives
**here** by an intentional project decision — so this is the "Tenant **& Billing**" service. That's the
one place we knowingly differ from the spec; it's documented in [NOTE.md](NOTE.md). The billing-specific
guides are [BILLING.md](BILLING.md), [BILLING_TASKS.md](BILLING_TASKS.md), [TECH_DOC.md](TECH_DOC.md),
and [billing_scenarios.md](billing_scenarios.md).

## Running it locally

```bash
pnpm install
# needs Postgres + Redis (+ Ory/LocalStack for full auth/messaging) running locally
npx prisma generate          # build the DB client
npx prisma db push           # sync your local DB to the schema
npx prisma db seed           # load currencies, plans, and the OWNER/ADMIN/OPERATOR/VIEWER roles
pnpm start:dev               # run with hot reload
```

Swagger API docs are served once the app is running. To explore without other services, the BDD suite
mocks the external bits (JWKS, Keto, Stripe) — see the testing section below.

## Testing it

```bash
pnpm test            # fast unit tests (no external services)
pnpm test:bdd        # full behaviour tests (needs a live Postgres); mocks Ory/Stripe
pnpm test:bdd:auth   # just the auth scenarios
pnpm test:bdd:billing
pnpm test:bdd:guards
```

If you only want to see the scenarios without running them: `pnpm test:bdd:dry`. The BDD setup is
described in [bdd-features.md](bdd-features.md).

## Where to go next

- The full technical map → [tenant-implementation.md](tenant-implementation.md)
- Decisions, gaps, and cross-team contract items → [NOTE.md](NOTE.md)
- Billing details → [BILLING.md](BILLING.md) and [billing_scenarios.md](billing_scenarios.md)
- The canonical platform specs (read-only) → `docs/`
