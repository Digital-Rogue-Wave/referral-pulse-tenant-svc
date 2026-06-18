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

## Module map

| Module | Path | Responsibility |
|---|---|---|
| `tenant` | `src/features/tenant` | Tenant CRUD (agnostic/admin/aware), lifecycle (suspend/lock/delete), stats |
| `users` | `src/features/users` | User/role projection, `user.*` events, `/users/me`, `/internal/validate-token` |
| `team-member` | `src/features/team-member` | Membership + role per tenant (last-admin protection) |
| `api-key` | `src/features/api-key` | API key lifecycle (SHA-256 hash, prefix, scopes, key_type) |
| `invitation` | `src/features/invitation` | Team invitations (send/accept/revoke), expiry job |
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
| GET/POST/PUT/DELETE | `/v1/api-keys`, `/v1/api-keys/:id`, `/v1/api-keys/:id/status` | api-key | Keto-guarded; raw key shown once |
| GET | `/v1/users/me` | users | Current user profile + roles/scopes |
| GET | `/v1/internal/validate-token` | users | **Public/internal** — resolve API key or JWT → claims |
| POST/GET/PUT/DELETE | `/v1/team-members`, `/v1/team-members/:id` | team-member | Role/status; last-admin protection |
| POST/GET | `/v1/tenants` | tenant | Create (agnostic), current-tenant reads |
| GET/PUT/DELETE | `/v1/admin/tenants`, `/v1/admin/tenants/:id` | tenant | Admin tenant management |
| GET (internal) | `/internal/tenants/:id/...` | billing/tenant | Internal billing/tenant status |
| GET/POST/PUT/DELETE | `/v1/invitations`, `/v1/invitations/public/...` | invitation | Send/accept/revoke; public accept |
| GET/PUT | `/v1/tenant-settings`, `/v1/me/notification-preferences` | tenant-setting | Settings + notification prefs |
| GET/POST/PUT/DELETE | `/v1/billings`, `/v1/billings/plans`, `/v1/billings/admin/plans` | billing | Subscriptions, public + admin plans |
| GET/POST/PUT | `/v1/files`, `/v1/currencies` | files/currency | Uploads; currency reference data |
| POST | `/v1/webhook/stripe`, `/webhooks/stripe` | webhook | Stripe webhook (version-neutral relay) |

> Role assignment for the `/users/:id/roles` contract path is served by `PUT /v1/team-members/:id`
> (projects `user_roles`, emits `user.role_changed`) — see `NOTE.md`.

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
| `tenant.*` (created/updated/deletion-*) | `tenant`-domain | tenant lifecycle (audit + SNS) |

Internal EventEmitter2 events keep camelCase payloads (`api-key.created`, `team-member.*`, etc.);
camelCase→snake_case mapping happens only at the SNS boundary. Audit events route to `AUDIT_TRAIL_FIFO`.

### Consumed

Per spec, the identity/tenant service consumes **nothing**. The one consumer is part of the intentional
billing extension:

| Queue | Event | Handler | Notes |
|---|---|---|---|
| `analytics-svc.fifo` | `referral.*` usage `{metric, delta}` | `BillingConsumer` | Hardened to accept metric/delta nested or top-level; queue/producer are cross-team contract items (see `NOTE.md`) |

> `CampaignEventsConsumer` (`CAMPAIGN_SVC_FIFO`) is an out-of-scope dead stub flagged for removal in `NOTE.md`.

## Owned DB tables (Prisma — `src/prisma/schema/`)

| Table | Schema file | Purpose |
|---|---|---|
| `tenants` | `tenant.prisma` | Tenant root; status, payment_status, trial, lock, custom domain |
| `users` | `user.prisma` | Platform user projection, keyed by `(tenant_id, kratos_identity_id)` |
| `roles` | `user.prisma` | Role definitions → scopes (seeded: OWNER/ADMIN/MEMBER/VIEWER) |
| `user_roles` | `user.prisma` | User↔role assignment per tenant |
| `team_members` | `team-member.prisma` | Membership + denormalized role (retained; overlaps users/user_roles) |
| `api_keys` | `api-key.prisma` | API keys (key_hash, key_prefix, key_type, scopes) |
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
| Invitation expiry | invitation module | Expire stale invitations |

## Scope decisions & deviations

See `NOTE.md` for the full, meeting-shareable record. Summary:
1. **Billing retained** (intentional) despite the spec scoping it out.
2. **`oauth2_clients`/`sessions`** delegated to Ory — no local tables (spec notes confirm Ory ownership).
3. **`users`/`user_roles`** added as the spec-canonical store, projected from the team-member lifecycle;
   `team_members` retained as the existing API surface (consolidation is a follow-up).
4. **`PUT /users/:id/roles`** served by the existing team-member update (no duplicate path).
5. **Inbound usage contract** hardened (shape-tolerant); producer/queue are cross-team items.
6. **Recorded gaps:** `tenants.verification_status`; role naming `Operator`↔`MEMBER`; stale migration
   baseline; out-of-scope `CampaignEventsConsumer` flagged for removal.

## Verification

```bash
pnpm build           # 0 issues (tsc + swc)
pnpm lint:check      # 0 errors (warnings are pre-existing, non-failing)
pnpm test            # unit (Jest)
pnpm test:bdd        # Cucumber (needs a live Postgres); also :auth / :billing / :guards
```

Prisma: `npx prisma generate` after schema edits; `npx prisma migrate dev --name <name>` to create +
apply migrations. Seed roles/plans/currencies + tenant/billing mock data via `npx prisma db seed`.
