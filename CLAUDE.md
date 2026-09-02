# CLAUDE.md — NestJS Microservices Project Configuration

## Identity

You are an expert senior TypeScript/NestJS architect working on a production microservices platform.
The tech lead reviewing your work has 17+ years of experience. Write code for a senior audience.

## Core Principles (Non-Negotiable)

### 1. Never Guess — Ask or Say "I Don't Know"
- **NEVER fabricate** API signatures, config options, method names, or library behavior. If unsure, say so.
- **NEVER suppose** what a method does, what a config accepts, or how a library works. Verify first.
- **ALWAYS research** the latest version of library/framework documentation before writing code that uses it:
  - Use Context7 MCP for NestJS, Prisma, Ory, BullMQ, Zod, opossum, Temporal, and any dependency.
  - If Context7 has no result, say so — do not fall back to training data guesses.
  - Training data is stale. The docs are the source of truth. Always.
- State assumptions explicitly. If uncertain, ASK — do not guess.
- If multiple interpretations exist, present them. Do not pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing.
- If information is missing (a DTO shape, a queue name, an env var, a service contract), ask for it — do not invent it.
- If you don't know the answer, say "I don't know" — that's always better than a wrong guess.

### 2. Simplicity First (KISS + YAGNI)
- Minimum code that solves the problem. Nothing speculative.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No premature optimization. No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.
- Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
- Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting uninvited.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated issues, mention them — don't fix them silently.
- Every changed line should trace directly to the request.

### 4. Plan Mode is Default
- **ANY task with 3+ steps starts in plan mode.** No exceptions.
- If something goes sideways mid-implementation, STOP — switch back to plan mode and re-plan.
- Write detailed specs upfront. Ambiguity → wrong direction → wasted tokens.
- State the plan with numbered steps, files involved, and verification for each step.
- For complex plans, ask a second review: "As a staff engineer, would you approve this plan?"

### 5. Verify Before Done
- **Never mark a task complete without proving it works.**
- Run the tests. Check the logs. Demonstrate the behavior.
- Ask: "Would a staff engineer approve this PR?"
- Verification 2-3x the quality of the final output. Never skip it.

### 6. Self-Improvement Loop (lessons.md)
- After ANY correction from the developer, update `tasks/lessons.md` with a rule that prevents the same mistake.
- Write rules in imperative form: "Always use ulid(), never uuid()" — not explanations.
- Review `tasks/lessons.md` at the start of every session.
- The file compounds over time — every line exists because it solved a real problem.
- Ask: "Should I add this to lessons.md?" after fixing a non-obvious mistake.

## Tech Stack

- **Runtime**: Node.js 22+ / TypeScript 5.x (strict mode always)
- **Framework**: NestJS 11.x with Express adapter
- **ORM**: Prisma 7.x (composition pattern, `@prisma/adapter-pg`) + PostgreSQL via AWS RDS
- **Analytics DB**: ClickHouse (`@clickhouse/client`)
- **Workflow Engine**: Temporal.io (referral workflows, reward approval, fraud review, optimization jobs)
- **Background Jobs**: BullMQ with Redis (web/worker mode split via `APP_MODE`)
- **Messaging**: AWS SQS FIFO / AWS SNS + EventEmitter2 for domain events
- **Auth**: Ory Kratos (identity) + Ory Hydra (OAuth2) + Ory Keto (permissions)
- **Resilience**: opossum circuit breaker, LRU cache, retry with backoff
- **Observability**: OpenTelemetry (traces, metrics), Pino structured logging, Grafana Cloud
- **Infrastructure**: AWS ALB → Traefik → NestJS (9 services), Kubernetes
- **Testing**: Jest + Supertest for API integration tests
- **Validation**: class-validator + class-transformer for DTOs, Zod for config validation
- **Context**: AsyncLocalStorage (nestjs-cls) for tenant/correlation propagation
- **IDs**: ULID (not UUID)
- **Package Manager**: pnpm 10+ (monorepo with workspaces)

## Platform Architecture (9 Microservices)

Full architecture spec: `docs/referralai_system_architecture_v1.md` (read relevant sections on demand, never the whole file).

| # | Service | DB | Owns |
|---|---------|------|------|
| 1 | `tenant-service` | tenant_db | Users, roles, API keys, Ory Kratos/Hydra/Keto |
| 2 | `campaign-service` | campaign_db | Programs, campaigns, variants, pulses, playbooks |
| 3 | `segmentation-service` | segmentation_db | Segments, eligibility rules, A/B allocation |
| 4 | `ingestion-service` | Redis only | Stateless event gateway — validation, dedup, context derivation |
| 5 | `referral-service` | referral_db | Referrals, links, profiles, attribution, Temporal workflows |
| 6 | `reward-service` | reward_db | Rewards, payouts, caps, clawbacks |
| 7 | `analytics-service` | analytics_db + ClickHouse | KPIs, funnels, A/B stats, revenue reporting |
| 8 | `notification-service` | notification_db | Webhooks, email, delivery retry |
| 9 | `ai-service` | ai_db | Fraud scoring (3-tier), LangChain agents, recommendations |

**Event bus**: SNS topics → FIFO SQS queues per consuming service. Each service has one inbound queue.
**Each service has its own repo**, its own `.claude/` config, and its own Claude Code session.

## Infrastructure Repository (Local Dev)

A separate `referralai-infra` repo contains `docker-compose.yml` with all dependencies for local development. **NestJS services run natively (not in Docker)** — they connect to these containers:

| Container | Port | Purpose |
|-----------|------|---------|
| PostgreSQL 16 | 5432 | All RDS databases (separate DBs per service) |
| Redis 7 | 6379 | Cache, dedup, BullMQ, rate limiting |
| LocalStack | 4566 | SQS, SNS, S3 (local AWS emulation) |
| Ory Hydra | 4444/4445 | OAuth2 public + admin APIs |
| Ory Kratos | 4433/4434 | Identity public + admin APIs |
| Ory Keto | 4466/4467 | Permission read + write APIs |
| Temporal | 7233 | Workflow engine |
| Temporal UI | 4040 | Workflow dashboard |
| Adminer | 8080 | Database browser |

**Start infrastructure**: `docker compose up -d` (in the infra repo)
**Run a service**: `pnpm start:dev` (in the service repo — connects to containers above)
**Integration/e2e tests**: Run against the Docker infrastructure (real PostgreSQL, real Redis, real LocalStack)

## Project Structure (Per Microservice)

```
src/
├── main.ts                    # Bootstrap with global pipes/filters/interceptors
├── app.module.ts              # Root module — ConfigModule → CommonModule → CoreModule → FeaturesModule
├── config/                    # Fail-fast configuration (registerAs + Zod validation)
├── common/                    # Cross-cutting: exceptions, filters, interceptors, middleware, pipes, context
│   ├── exceptions/            # BaseException hierarchy (ValidationException, NotFoundException, etc.)
│   ├── interceptors/          # AlsAuthInterceptor, LoggingInterceptor, TransformInterceptor
│   ├── guards/                # JwtAuthGuard, RolesGuard
│   ├── events/listeners/      # Event listeners → SideEffectService for async external calls
│   ├── messaging/             # MessageEnvelopeService, SqsProducerService, SnsPublisherService
│   ├── side-effects/          # SideEffectService (outbox pattern + direct SQS/SNS)
│   ├── bulljobs/              # BullJobsService, BaseWorkerService, BullJobsConnectionFactory
│   ├── tenant-aware/          # TenantContextService, TenantAwareService (multi-tenancy)
│   ├── redis/                 # RedisService, RedisKeyBuilder
│   └── logging/               # AppLoggerService (Pino-based structured logging)
├── database/                  # DatabaseService (Prisma composition), data-source
├── domains/                   # All DTOs, Responses, and mappers for HTTP and messaging
├── health/                    # Health module: /health/live (ALB), /health/ready, /health
├── types/                     # All custom types, interfaces, error codes, queue/job constants
├── features/                  # Business feature modules
│   └── {entity}/              # module, controller, service, repository, processors/
└── deployment/                # Helm charts (variablised for staging/production)
```

**Deployment**: via GitHub Actions (CI/CD). Not manual.
**When adding a new env variable**: always update `deployment/` Helm values files to include it. Review the Helm templates to ensure the variable is injected into the container spec.

## Coding Standards

Detailed patterns: `nestjs-api` skill (21 reference files) + `.claude/rules/` (7 files).
Architecture rules (SOLID, OOP, Object Calisthenics, messaging flow, BullMQ): `.claude/rules/architecture.md`.

- **Validation**: class-validator + class-transformer for DTOs. Zod for config only.
- **Modules**: aggregation — ConfigModule → CommonModule → CoreModule → FeaturesModule.
- **Controllers**: thin. Validate input, delegate to service, return DTO.
- **Services**: business logic only. No HTTP concerns, no direct Prisma.
- **Database**: Prisma 7.x composition. TenantAwareService for multi-tenancy.
- **Auth**: Ory Kratos + Hydra + Keto. Deny-by-default.
- **Errors**: BaseException → GlobalExceptionsFilter → RFC 9457 ProblemDetail.
- **Observability**: Pino + OpenTelemetry. Correlation IDs via AsyncLocalStorage.
- **IDs**: `ulid()` only. Never `uuid()`.
- **Idempotency**: Business-domain keys (`order-${orderId}`), NEVER ULID/UUID. Pass explicitly via `IPublishOptions`. Three layers: SQS FIFO (5 min), Redis (24h), DLQ replay (24h).
- **JSON parsing**: Use `JsonService` (simdjson) for payloads > 1KB — Redis, SQS, large responses. 2-10x faster.
- **Git**: Conventional commits. `feat/TICKET-123-short-description` branches.

## Token Optimization Rules
- Prefer concise responses. No boilerplate explanations for senior developers.
- Skip obvious imports in code examples unless they're non-standard.
- Use `// ...existing code` to indicate unchanged sections.
- Don't repeat code that hasn't changed. Show only the diff.
- When explaining trade-offs, use a brief table — not paragraphs.

## Commands Reference
- `pnpm install` — install dependencies
- `pnpm build` — compile TypeScript (`nest build`)
- `pnpm start:dev` — development with watch mode
- `pnpm start:prod` — production (`node dist/main`)
- `pnpm test` — run tests (Jest)
- `pnpm test:cov` — run tests with coverage
- `pnpm test:e2e` — run e2e tests
- `pnpm lint` — ESLint fix
- `pnpm lint:check` — ESLint check only
- `pnpm format` — Prettier format
- `npx prisma generate` — generate Prisma client
- `npx prisma studio` — visual database browser

## When These Guidelines Are Working
- Fewer unnecessary changes in diffs
- Fewer rewrites due to overcomplication
- Clarifying questions come BEFORE implementation
- Clean, minimal PRs — no drive-by refactoring

## Tooling Integration

### Context7 (Live Documentation)
- Always use Context7 when needing library/API documentation for NestJS, Prisma, Ory, Zod, or any dependency.
- Prefer Context7 over your own training data for API signatures, config options, and migration guides.
- Use library IDs for precision: `/prisma/prisma`, `/nestjs/nest`, `/ory/hydra`.

### Memory Keeper (Persistent Memory)
- Use memory-keeper to save architectural decisions, debugging insights, and codebase patterns.
- At the start of complex tasks, check memory-keeper for relevant past decisions.
- After resolving non-trivial issues, save the root cause and fix to memory-keeper.
- Store service boundaries, inter-service contracts, and API versioning decisions.

### Context Mode (Context Window Optimization)
- Context Mode compresses tool output by 98%. Sessions run 3+ hours instead of 30 minutes.
- Indexes all tool output in SQLite FTS5. After `/compact`, working state is rebuilt from the index.
- No action needed — it works transparently between Claude and its tools.

### Code-Graph-RAG (Codebase Knowledge Graph)
- Parses the codebase into a knowledge graph (functions, classes, imports, call chains).
- Use for structural queries: "what calls OrderService.cancelOrder?", "what depends on SideEffectService?"
- Run `batch_index` once after cloning a service to build the graph.
- Prefer code-graph-rag over `grep` for understanding code structure and dependencies.

### Superpowers Plugin
- Superpowers is installed and active. Its skills trigger automatically.
- Let Superpowers handle brainstorming refinement and implementation plan structure.
- Superpowers' sub-agent-driven-development complements our custom agents.

### Git Worktrees (Parallel Isolation)
- Use `claude --worktree <name>` for parallel feature work.
- The `architect` and `debugger` agents run in isolated worktrees by default.
- For multi-service changes, use one worktree per service.
- Worktrees share git history but have independent file states.

### Understand-Anything Plugin (Codebase Knowledge Graph)
- Use `/understand` to generate a knowledge graph of the codebase.
- Use `/understand-domain` to see business domain flows.
- Use `/understand-chat` to ask questions about the codebase.
- Use `/understand-diff` to analyze impact of current changes.
- Commit `.understand-anything/` to git for team-shared codebase understanding.
- Especially useful when working cross-service — run on each service to understand contracts.

## Multi-Microservice Context

This app has 9 NestJS microservices behind ALB + Traefik.
Each microservice has its own repo, its own `.claude/` config, and its own Claude Code session.

### Shared Context Pattern
Maintain a shared `docs/` folder at each service root for cross-cutting knowledge:

```
docs/
├── referral_platform_product_spec.md              # Product specification / PRD (the big spec doc)
├── referralai_db_tables_per_service.md            # Database schema of each service
├── referralai_system_architecture_v1.md           # System-wide architecture (all 8 services, contracts, flows)
├── referralai_event_model_v2.1.md                 # Inter-service API contracts (event schemas, endpoints)
├── referralai_failure_observability_model_v2.md   # Handle plateform failures and observability
├── referralai_api_contract_v1.2.md                # Exposed REST API
├── referralai_responsibility_contract_v2.md       # SDK responsability
└── DECISIONS.md                                   # Architectural Decision Records (ADRs)
```

### How to feed business context to Claude Code
- **Large spec**: Put it in `docs/referral_platform_product_spec.md`. Tell Claude: `"Read docs/referral_platform_product_spec.md for the full product spec"`
- **Data Model**: Put it in `docs/referralai_db_tables_per_service.md`. Tell Claude: `"Read docs/referralai_db_tables_per_service.md to understand data model"`
- **Cross-service contracts**: Put event schemas and API contracts in `docs/API-referralai_event_model_v2.md`
- **System architecture**: Put it in `docs/referralai_system_architecture_v1.md` to understand the whole plateform architecture
- **System architecture**: Put it in `docs/referralai_responsibility_contract_v2.md` to understand the SDK relation with Backend
- **Never paste** the entire spec into the chat — point Claude at the file. It reads what it needs.
- For very large specs (500+ lines), tell Claude which section: `"Read the Order Cancellation section of docs/referral_platform_product_spec.md"`

### Working across services
- One WebStorm window + one Claude Code session per service you're actively changing.
- Use `@architect` in the first service to design the cross-service contract.
- Copy the contract to `docs/API-referralai_event_model_v2.md` in both services.
- Implement each side independently, referencing the shared contract.
- Use Understand-Anything's `/understand-domain` to verify domain flows match across services.

### Session start for multi-service work
```
"I'm working on [service-name]. Related services: [list them].
Read docs/referral_platform_product_spec.md section [X] for business context.
Read docs/referralai_event_model_v2.1.md for the event schema between these services.
Read docs/referralai_api_contract_v1.1.md for the exposed api.
Read docs/referralai_system_architecture_v1.md for plateform architecture.
Check memory-keeper for past decisions about this flow."
```

---

# Service-Specific: Tenant & Billing Service (`referral-pulse-tenant-svc`)

> Everything above is the shared platform standard. This section is what makes THIS service specific.
> The canonical specs live (read-only) in `docs/`. Editable service docs: `tenant-implementation.md`
> (whole-service technical reference), `TENANT_GUIDE.md` (beginner walkthrough), `NOTE.md` (decisions +
> cross-team contract items), and the billing-focused `BILLING.md` / `BILLING_TASKS.md` / `TECH_DOC.md` /
> `billing_scenarios.md`. `docs/` and `docs/specs/` are READ-ONLY — never edit them.

## Scope (authoritative)

Derived from `docs/referralai_responsibility_contract_v2.md`, `docs/referralai_db_tables_per_service.md`,
and `docs/referralai_system_architecture_v1.md`. This service is the platform's **Identity / Tenant**
service AND — per the project decision — also owns **client billing** (see deviation below).

**Owns (identity/tenant):** tenants, users, roles, user_roles, api_keys. Ory Kratos (identity), Ory Hydra
(OAuth2), Ory Keto (permissions) are the credential/permission authorities; `oauth2_clients` and
`sessions` are delegated to Ory (no local tables — intentional, recorded in `NOTE.md`).

**Owns (billing — intentional extension):** plans, billings, billing_events, tenant_usages, plus Stripe
subscription/checkout/upgrade/downgrade, Stripe webhooks, usage metering, and payment-status escalation.

**Not this service's concern (per spec):** participant identity, programs/campaigns, referrals, rewards,
payouts, event ingestion. Don't add those here.

### Intentional deviation — billing is kept

The canonical specs scope billing OUT of this service (payout → reward service; Stripe-webhook relay →
referral-workflow service; client subscriptions = later phase). Per the project decision, billing is
**retained** here as a sanctioned extension. Nothing billing is removed. This is the one place this
service knowingly diverges from the responsibility contract — see `NOTE.md` for the full record.

## Events

- **Publishes (identity):** `user.registered`, `user.role_changed`, `api_key.created`, `api_key.revoked`
  — snake_case payloads per `docs/referralai_event_model_v2.1.md` §4.12, fanned out to SNS via the
  broadcast listener (`src/common/events/listeners/broadcast-event.listener.ts`).
- **Publishes (billing, intentional):** `subscription.*`, `payment.failed/restored`,
  `tenant.restricted/locked/restored`, `usage.*` to `BILLING_EVENTS_TOPIC`.
- **Consumes:** per spec, the identity/tenant service consumes nothing. The billing usage consumer on
  `ANALYTICS_SVC_FIFO` is part of the intentional billing extension. Inbound handlers accept both
  snake_case and camelCase defensively (see `NOTE.md`).
- `user.logged_in` happens at Ory/gateway and is NOT emitted by this service.

## Stack notes specific to this service

- **ORM is Prisma** (schemas in `src/prisma/schema/*.prisma`, one file per aggregate). Migrations under
  `src/prisma/migrations/`. There is no TypeORM here.
- **IDs:** `ulid()` everywhere — `@id @default(ulid()) @db.VarChar(26)`. Per the platform ruling
  (2026-09-02), every microservice uses ULID and no longer cuid, so the fleet has one id format on
  the wire. All 13 `cuid()` primary keys in this service were migrated in
  `20260903003657_ulid_id_harmonize`; the PK columns are pinned to `VarChar(26)` to match the
  foreign-key columns that already declared that width. **The previous "match the surrounding model
  when editing existing schemas" carve-out is superseded — there are no cuid models left.** Existing
  rows keep their old 25-char cuid values, which remain valid under `VarChar(26)`; only new rows get
  ULIDs, since `ulid()` is a Prisma client-side default and emits no DDL.
- **Tests:** Jest unit (`pnpm test`) + Cucumber BDD (`pnpm test:bdd`, `:auth`, `:billing`, `:guards`),
  config in `cucumber.cjs`, docs in `bdd-features.md`. BDD uses real JWT/guards with mocked JWKS/Keto/Stripe.

## Service-specific commands

- `npx prisma generate` — regenerate the Prisma client after schema edits.
- `npx prisma migrate dev --name <name>` — create + apply a dev migration.
- `pnpm test:bdd` — run the full Cucumber suite (also `:auth` / `:billing` / `:guards`).
