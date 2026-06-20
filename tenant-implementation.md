# Tenant & Billing Service — Implementation Reference

Full technical implementation reference for the **entire** `referral-pulse-tenant-svc` microservice —
every module, API endpoint, published/consumed event, owned DB table, and background job, plus the scope
decisions and deviations from the canonical specs.

> This is the whole-service reference. Billing-specific deep-dives stay in `BILLING.md`,
> `BILLING_TASKS.md`, `TECH_DOC.md`, and `billing_scenarios.md` — referenced here, not duplicated.
> Canonical specs live (read-only) in `docs/`; meeting-shareable decisions/contract items in `NOTE.md`.

## Scope (authoritative)

Derived from `docs/referralai_responsibility_contract_v2.md`,
`docs/referralai_db_tables_per_service.md`, and `docs/referralai_system_architecture_v1.md`. This is the
platform's **Identity / Tenant** service and — per the project decision — also owns **client billing**.

- **Identity/tenant (per spec):** tenants, users, roles, user_roles, api_keys. Ory Kratos (identity),
  Hydra (OAuth2), Keto (permissions) are the credential/permission authorities.
- **Billing (intentional extension, per the decision):** plans, billings, billing_events, tenant_usages;
  Stripe subscriptions/checkout/upgrade/downgrade, webhooks, usage metering, payment-status escalation.
- **NOT this service's concern:** participant identity, programs/campaigns, referrals, rewards, payouts,
  event ingestion.

### The one intentional deviation
The canonical responsibility contract scopes billing **out** of this service (payout → reward service;
Stripe-webhook relay → referral-workflow service; client subscriptions = later phase). Per the decision,
billing is **retained** here. This is the single knowing divergence — full record in `NOTE.md`.

## Stack

| Concern | Choice |
|---|---|
| Runtime / framework | Node 22+, NestJS 11 (Express), TypeScript strict |
| ORM / DB | Prisma 7 (`@prisma/adapter-pg`) + PostgreSQL |
| Cache / jobs | Redis (ioredis), BullMQ |
| Messaging | AWS SNS (fan-out) + SQS FIFO; EventEmitter2 for in-process domain events |
| Auth | Ory Kratos (identity) + Hydra (OAuth2 JWT) + Keto (permissions) |
| Observability | OpenTelemetry, Pino → Grafana Cloud |
| IDs | `ulid()` (older Prisma models use `cuid()` defaults) |
| Package manager | pnpm 10 |

## Architecture at a glance

- **HTTP** → global `JwtAuthGuard` (skip with `@Public()`) → `PermissionGuard` (Ory Keto) → controller →
  service → Prisma (tenant-scoped via `TenantAwareService`).
- **Domain events** are emitted after commit (`TransactionEventEmitterService.emitAfterCommit`) and
  fanned out to SNS by `BroadcastEventListener`; audit events go to `AUDIT_TRAIL_FIFO` via per-domain
  listeners; critical side effects use the outbox (`SideEffectService`).
- **Inbound SQS** is handled by `MessageProcessorService` (idempotency + tenant context).
- **Background work** runs on BullMQ (billing usage/escalation/trials, tenant deletion/unlock).
- **Errors** follow the canonical model (`referralai_api_contract` §error model): `BaseException(code,
  message, status, param?, details?)` → `GlobalExceptionsFilter` emits
  `{ error: { code, message, param?, requestId, correlationId?, details? } }` (+ `X-Request-Id` header);
  `code` is lowercase snake_case (`ErrorCode` union).

## Module map

| Module | Path | Responsibility |
|---|---|---|
| `tenant` | `src/features/tenant` | Tenant CRUD (agnostic/admin/aware), lifecycle (suspend/lock/delete), stats |
| `users` | `src/features/users` | Platform users: membership + role (last-admin protection), `user.*` events, `/users` CRUD, `/users/me`, `/internal/validate-token` |
| `api-key` | `src/features/api-key` | API key lifecycle (SHA-256 hash, prefix, scopes, key_type) |
| `invitation` | `src/features/invitation` | Team invitations — create/list/resend/revoke + public token validate/accept (**sanctioned extension**, not in the API contract). Expiry is lazy (checked on validate/accept) |
| `tenant-setting` | `src/features/tenant-setting` | Tenant settings + user notification preferences |
| `dns` | `src/features/dns` | Subdomain reservation + custom-domain provisioning/verification |
| `files` | `src/features/files` | S3 upload/download |
| `billing` | `src/features/billing` | Plans, subscriptions, Stripe, usage metering, payment escalation |
| `webhook` | `src/features/webhook` | Stripe webhook ingestion |
| `i18n` | `src/features/i18n` | Localization middleware (ar/en/fr) |

## API endpoints

All routes are versioned (`/v1/...`) and tenant-scoped unless marked Public/Internal.

| Method(s) | Path | Module | Notes |
|---|---|---|---|
| POST/GET/GET:id/PUT:id/DELETE:id | `/v1/api-keys` | api-key | Create/list/get/update(label,scopes)/revoke; Keto-guarded; raw key shown once. DELETE = revoke (sets `revoked_at`, irreversible) |
| GET | `/v1/users/me` | users | Current user profile + roles/scopes |
| POST/GET/PUT/DELETE | `/v1/users`, `/v1/users/:id`, `/v1/users/:id/roles` | users | Membership + role; last-admin protection |
| GET | `/internal/validate-token` | users | **Public/internal**, version-neutral — resolve API key or JWT → `{tenant_id, scopes, source, key_type, key_id, user_id}` |
| PATCH | `/v1/internal/tenants/:id/verification` | tenant | **Internal** — workflow svc verification decision callback |
| POST/GET | `/v1/tenants` | tenant | Create (agnostic), current-tenant reads |
| POST | `/v1/admin/tenants/:id/suspend`, `/v1/admin/tenants/:id/unsuspend` | tenant | **Platform-admin** — service token or Keto `tenant:update` (`allowServiceTokens`) |
| GET (internal) | `/internal/tenants/:id/...` | billing/tenant | Internal billing/tenant status |
| POST/GET/POST:id/resend/DELETE:id | `/v1/invitations` | invitation | Create/list/resend/revoke; Keto `tenant:user` perms; emits `invitation.created/resent` (email) |
| GET / POST:token/accept | `/v1/invitations/public/:token` | invitation | **Public** token validate; accept requires invitee's Ory JWT (`@AllowNoTenant` — tenant-optional, email must match) → provisions membership, emits `user.registered` |
| GET/PUT | `/v1/tenant-settings`, `/v1/me/notification-preferences` | tenant-setting | Settings + notification prefs |
| GET/POST/PUT/DELETE | `/v1/billings`, `/v1/billings/plans`, `/v1/billings/admin/plans` | billing | Subscriptions, public + admin plans |
| GET/POST/PUT | `/v1/files`, `/v1/currencies` | files/currency | Uploads; currency reference data |
| POST | `/v1/webhook/stripe`, `/webhooks/stripe` | webhook | Stripe webhook (version-neutral relay) |

> `PUT /v1/users/:id/roles` updates the role and emits `user.role_changed`; `users`/`user_roles` is the
> system of record (the former `/team-members` surface was consolidated away).

## Events

### Published (→ SNS via `BroadcastEventListener`)

| Event type | Topic | Payload (wire, snake_case) |
|---|---|---|
| `user.registered` | `user-events-topic` | `user_id, tenant_id, role` |
| `user.role_changed` | `user-events-topic` | `user_id, tenant_id, old_role, new_role` |
| `api_key.created` | `user-events-topic` | `key_id, key_type, tenant_id, created_by` |
| `api_key.revoked` | `user-events-topic` | `key_id, revoked_by, revocation_reason` |
| `subscription.*` | `billing-events-topic` | subscription/stripe fields (billing extension) |
| `payment.failed` / `payment.restored` | `billing-events-topic` | payment-status fields |
| `tenant.restricted` / `tenant.locked` / `tenant.restored` | `billing-events-topic` | payment-status fields |
| `tenant.*` (created/updated/suspended/locked/deletion-*) | `tenant-events` | tenant lifecycle |
| `tenant.verification_requested` | `tenant-events` | `tenant_id, tenant_name, requested_by` (emitted at signup) |
| `tenant.verification_status_changed` | `tenant-events` | `tenant_id, previous_status, new_status, reason` |

Internal EventEmitter2 events keep camelCase payloads (`api-key.created`, etc.);
camelCase→snake_case mapping happens only at the SNS boundary. Audit events route to `AUDIT_TRAIL_FIFO`.

### Consumed

Per spec, the identity/tenant service consumes **nothing**. The one consumer is part of the intentional
billing extension:

| Queue | Event | Handler | Notes |
|---|---|---|---|
| `analytics-svc.fifo` | `referral.*` usage `{metric, delta}` | `BillingConsumer` | Hardened to accept metric/delta nested or top-level; queue/producer are cross-team contract items (see `NOTE.md`) |

> The former out-of-scope `CampaignEventsConsumer` (`CAMPAIGN_SVC_FIFO`) has been removed (it was a dead stub; the tenant service consumes no domain events except the billing-extension usage event above).

## Owned DB tables (Prisma — `src/prisma/schema/`)

| Table | Schema file | Purpose |
|---|---|---|
| `tenants` | `tenant.prisma` | Tenant root; status, payment_status, trial, lock, custom domain |
| `users` | `user.prisma` | Platform users (operators): membership + denormalized `role`, keyed by `(tenant_id, kratos_identity_id)` |
| `roles` | `user.prisma` | Role definitions → scopes (seeded: OWNER/ADMIN/OPERATOR/VIEWER) |
| `user_roles` | `user.prisma` | User↔role assignment per tenant |
| `api_keys` | `api-key.prisma` | `label`, bcrypt `key_hash` (cost 12), `key_prefix` (last 4 chars), `key_type` (secret/publishable), `scopes`, `revoked_at` (null = active). Raw key prefixed `rai_live_` (secret) / `rai_pub_` (publishable) per api_contract §2.2. Validation narrows by last-4 prefix then `bcrypt.compare` |
| `invitations` | `invitation.prisma` | Team invitations |
| `tenant_settings`, `user_notification_preferences` | `tenant-setting.prisma` | Settings + prefs |
| `reserved_subdomains` | `dns.prisma` | Subdomain reservations |
| `files` | `file.prisma` | File metadata |
| `currencies` | `currency.prisma` | Currency reference data |
| `plans`, `billings`, `billing_events`, `tenant_usages` | `billing.prisma` | Billing extension |
| `side_effect_outbox` | `side-effect-outbox.prisma` | Outbox pattern |

> **Migration note:** the migration history was re-baselined — `20260219100415_init` is a single
> squashed baseline of the full schema. Use `prisma migrate dev` for new changes (see `NOTE.md`).

## Background jobs (BullMQ)

| Job | Source | Purpose |
|---|---|---|
| Billing usage tracking | `processors/billing-usage.processor.ts` | Persist metered usage |
| Monthly usage reset / daily snapshot | `monthly-usage-reset`, `daily-usage-calculator` | Usage windows |
| Payment-status escalation | `payment-status-escalation.service.ts` | PAST_DUE → RESTRICTED → LOCKED |
| Trial lifecycle | `trial-lifecycle.service.ts` | Trial reminders/expiry |
| Plan ↔ Stripe sync | `plan-stripe-sync.service.ts` | Reconcile plans with Stripe |
| Tenant deletion / unlock | `processors/tenant-deletion.processor.ts`, `tenant-unlock.processor.ts` | Scheduled lifecycle |
| Invitation expiry | invitation module | Lazy — stale invitations are marked `EXPIRED` on validate/accept (no cron) |

## Scope decisions & deviations

See `NOTE.md` for the full, meeting-shareable record. Summary:
1. **Billing retained** (intentional) despite the spec scoping it out — kept decoupled so it can move to
   another service later.
2. **`oauth2_clients`/`sessions`** delegated to Ory — no local tables (spec notes confirm Ory ownership).
3. **`users` (+`role`) / `user_roles`** are the system of record for membership; `team_members` was
   removed (consolidated per spec). `/users` endpoints replace `/team-members`; Keto resource `user`.
4. **Roles** renamed to the spec set Owner/Admin/**Operator**/Viewer. `users` has **no status** column
   (per spec; member deactivation deferred to Ory Kratos).
5. **`tenants.verification_status`** owned here; emits `tenant.verification_requested`, consumes the
   workflow svc decision via `PATCH /internal/tenants/:id/verification`.
6. **Inbound usage contract** hardened (shape-tolerant); producer/queue are cross-team items.
7. **Migration baseline** squashed; `CampaignEventsConsumer` (dead, out-of-scope) removed.

## Verification

```bash
pnpm build           # 0 issues (tsc + swc)
pnpm lint:check      # 0 errors (warnings are pre-existing, non-failing)
pnpm test            # unit (Jest)
pnpm test:bdd        # Cucumber (needs a live Postgres); also :auth / :billing / :guards
```

Prisma: `npx prisma generate` after schema edits; `npx prisma migrate dev --name <name>` to create +
apply migrations. Seed roles/plans/currencies + tenant/billing mock data via `npx prisma db seed`.
