# Tenant & Billing Service — Implementation Reference

Technical reference for the whole `referral-pulse-tenant-svc` microservice: modules, endpoints, events, tables,
background jobs and how to verify it. Last updated 2026-09-22 (batch 2).

> **Specs:** `spec/` (API Contract v1.3, Event Model v3, DB Model v2, Product Spec v4, Architecture). `docs/` is
> history only. **Every decision and the deferred list are in `NOTE.md` ("Decisions — batch 2").** What other
> services must provide: `my-docs/cross-service-requirements.md`. Billing deep-dives: `BILLING.md`,
> `billing_scenarios.md`.

## Scope

The platform's **identity/tenant** service, plus **client billing** (a sanctioned extension, see `NOTE.md`).

- **Owns:** tenants, users (operators), roles/user_roles (projection), API keys, company verifications, the
  platform audit trail, and the authorization model in Ory Keto. Ory Kratos (identity) and Hydra (OAuth2) are the
  credential authorities; tenant-service mints the **internal JWT** every other service trusts.
- **Billing:** plans, subscriptions (Stripe), usage metering and limits, dunning.
- **Consumes no queue** (Architecture §2.1). Other services call its internal API; it publishes `tenant-events`.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node 22+, NestJS 11 (Express 5), TypeScript strict |
| Data | Prisma 7 (`@prisma/adapter-pg`) + PostgreSQL; Redis (cache, BullMQ) |
| Messaging | SNS FIFO `tenant-events` via the transactional outbox; SQS producer only |
| Auth | Ory Kratos + Hydra + Keto; internal ES256 JWT (`/.well-known/jwks.json`) |
| Payments | Stripe (idempotent writes, webhooks with a durable event log) |
| Observability | OpenTelemetry (OTLP traces + metrics), Pino |
| IDs | ULID |

## Request path

1. Traefik forwardAuth → `GET /internal/validate-token` swaps the dashboard token or API key for the internal JWT
   (`tenant_id`, `user_id`, `perms`, …).
2. `JwtAuthGuard` (internal JWT or Hydra client-credentials) → `PermissionGuard` (deny by default; `perms` from the
   token, live Keto for high-risk permissions, platform admin and service capabilities) → `TenantAccessGuard`
   (suspended / locked / payment tiers, cached 15 s).
3. Interceptors: request idempotency (`Idempotency-Key`, `idempotency_keys`), request context (ALS), snake_case wire.
4. Errors: `{ error: { type, code, message, param, request_id, doc_url, details } }` (API v1.3).
5. A state change and its events commit together: before-commit hooks write `event_outbox` rows and `audit_log`
   rows in the same transaction; a relay publishes the outbox to SNS.

## Modules

| Module | Path | Responsibility |
|---|---|---|
| identity gateway | `features/identity-gateway` | `/internal/validate-token`, JWKS, internal token issuing |
| users | `features/users` | Membership and roles, ownership transfer, operator contacts, DSR erasure, Keto reconciler |
| tenant | `features/tenant` | Onboarding, profile/settings, lock/unlock (self and admin), suspend, deletion scheduling, verifications |
| tenant-deletion | `features/tenant-deletion` | The deletion saga and its hourly sweeper |
| api-key | `features/api-key` | HMAC-hashed keys, rotation, revocation, cached validation |
| invitation | `features/invitation` | Invitations (hashed tokens, atomic accept, seat-limited) |
| audit-log | `features/audit-log` | `audit_log` writer (from domain events) and `GET /v1/audit-log` |
| billing | `features/billing` | Plans, subscriptions, Stripe webhooks, usage counters, limits, entitlements, dunning |
| retention | `features/retention` | Nightly retention sweep |
| tenant-setting, dns, files, webhook | `features/…` | Settings/preferences, subdomains/custom domains (flagged), uploads, Ory hooks + Stripe webhook routes |
| common | `common/…` | Auth/Keto, HTTP contract, events/outbox, side effects, messaging (producer), Redis, BullMQ, monitoring |
| health | `health` | `/health/live`, `/health/ready`; worker pods: probe-only server on `WORKER_HEALTH_PORT` |

## API (all `/api/v1` unless noted)

| Area | Endpoints | Access |
|---|---|---|
| Gateway | `GET /internal/validate-token`, `GET /.well-known/jwks.json` (unprefixed) | Traefik (shared secret) |
| Users | `GET /users/me`, `POST/GET /users`, `GET /users/{id}`, `PUT /users/{id}/roles`, `DELETE /users/{id}` | `users:*` |
| Invitations | `POST/GET /invitations`, `POST /invitations/{id}/resend`, `DELETE /invitations/{id}`; `GET /invitations/public/{token}`, `POST …/accept` | `users:write`; public token |
| API keys | `POST/GET /api-keys`, `GET/PUT/DELETE /api-keys/{id}`, `POST /api-keys/{id}/rotate` | `api_keys:manage` (live Keto) |
| Tenant | `POST /tenants`; `GET /tenants/profile`, `PATCH /tenants`, `PUT /tenants/lock`, `/unlock`, `/transfer-ownership`, `/schedule-deletion`, `/cancel-deletion`; custom domain + subdomain routes | `tenants:*` |
| Settings | `/tenant-settings`, `/me/notification-preferences` | tenant |
| Audit | `GET /audit-log` (cursor + filters) | `audit:read` (Owner, Admin) |
| Billing | `/billings/subscription…`, `/billings/payment-methods…`, `GET /billings/invoices` (cursor), `POST /billings/portal-session`, `/billings/usage`, `/billings/plans`, admin `/billings/admin/plans` | `billing:*`; reachable while unpaid |
| Platform admin | `POST /admin/tenants/{id}/suspend`, `/unsuspend`, `/lock`, `/unlock` | platform admin or `tenant.suspend` |
| Internal (services) | `GET /internal/tenants/{id}/status`, `/entitlements`; `POST …/usage/increment`, `/decrement`; `PATCH …/verification`; `GET …/users/{userId}/contact`, `…/contacts?role=`; `POST /internal/erasures/operators` | service capabilities (see `NOTE.md` A6) |
| Webhooks | `POST /webhook/ory/signup`, `/webhook/ory/login` (shared key); `POST /webhook/stripe`, `/webhooks/stripe` (signature) | public, verified |

## Events (published on `tenant-events`, Event Model v3 envelope)

Registry: `common/events/outbox/published-events.ts` (the full list and properties; contract-tested in
`published-events.spec.ts`).

- **Identity:** `user.registered`, `user.role_changed`, `user.removed`, `user.invited`, `user.logged_in`,
  `user.anonymised`, `api_key.created`, `api_key.revoked`, `api_key.rotated`.
- **Tenant:** `tenant.created` (with `data_region`, `retention_months`), `tenant.updated`, `tenant.suspended`,
  `tenant.unsuspended`, `tenant.locked`, `tenant.unlocked`, `tenant.deletion_scheduled`, `tenant.deletion_cancelled`,
  `tenant.deleted`, `tenant.ownership_transferred`, `tenant.domain_verified`, `tenant.verification_requested`,
  `tenant.verification_status_changed`.
- **Billing:** `subscription.created/changed/cancelled/upgraded/downgrade_scheduled`, `trial.reminder`, `trial.expired`,
  `tenant.payment_status_changed`, `tenant.payment_restricted/locked/restored`, `payment.failed`, `payment.restored`,
  `payment.action_required`, `payment.dispute_opened/closed`, `payment.refunded`, `usage.threshold_crossed`,
  `usage.monthly_summary`.

## Tables (`src/prisma/schema/`)

| Tables | Notes |
|---|---|
| `tenants`, `tenant_verifications`, `tenant_settings`, `user_notification_preferences` | status `active/suspended/locked/closed`; verification states; residency and retention |
| `users`, `roles`, `user_roles`, `invitations` | status `invited/active/disabled`; erased operators anonymised in place |
| `api_keys` | HMAC key hash (peppered), 4-char display suffix |
| `audit_log` | append-only operator-action trail |
| `event_outbox`, `side_effect_outbox`, `idempotency_keys` | transactional outbox (events), Keto/SQS side effects, request idempotency |
| `plans`, `billings`, `billing_events`, `tenant_usages`, `usage_counters`, `stripe_events` | catalog, subscription state, history, daily snapshots, atomic counters, Stripe event log |
| `reserved_subdomains`, `files`, `currencies` | supporting data |

## Background jobs (BullMQ, worker pods only)

| Job | Schedule | Purpose |
|---|---|---|
| Outbox relay / prune | every 2 s / nightly | publish `event_outbox`, prune after 7 days |
| Side-effect outbox + sweeper | on demand / every minute | Keto and SQS side effects, re-enqueue stuck rows |
| Tenant deletion sweeper | hourly | run the deletion saga for tenants past `deletion_due_at` |
| Unlock sweeper | every 5 min | expire timed locks |
| Keto reconciler | 03:30 daily | restore Keto grants from the database |
| Billing: daily snapshot, monthly summary, dunning, trial lifecycle, Stripe plan sync | daily / monthly / hourly | usage history and thresholds, summaries, escalation, trials, catalog |
| Retention sweep | 04:20 daily | audit trail after tenant close, ended invitations, delivered side effects, Stripe events |
| Idempotency key sweeper | hourly | purge expired request keys |

## Verification

```bash
pnpm build              # compiles (0 TypeScript errors)
pnpm lint:check         # 0 errors
pnpm test               # unit (Jest)
pnpm test:cov           # unit + coverage gate (lines/statements 80 %)
pnpm test:integration   # against Docker Postgres/Redis (e.g. atomic usage counters)
pnpm test:bdd           # Cucumber HTTP flows (auth, billing incl. signed Stripe webhooks, guards)
```

Migrations: `src/prisma/migrations/` (applied with `npx prisma migrate deploy`; generate with `npx prisma generate`).
The `idx_outbox_pending` and `idx_tenants_deletion_due` partial indexes are SQL-only (Prisma cannot express them).
