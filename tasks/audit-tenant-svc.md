# tenant-svc — Conformance & Spec Audit

**Audit date:** 2026-05-12
**Repo:** `/Users/nizar/Developer/referralspace/referral-pulse-tenant-svc`
**Rubric:** Template Pattern Card (`referral-pulse-svc-template/tasks/template-pattern-card.md`)
**Canonical specs:** `referralai_system_architecture_v1`, `referralai_db_tables_per_service`, `referralai_event_model_v2.1`, `referralai_api_contract_v1.2`, `referralai_responsibility_contract_v2`, `referralai_failure_observability_model_v2`, `referral_platform_product_spec`.

---

## Executive summary

`tenant-svc` has the right bones — Pattern Card §2 bootstrap, §3 AppModule, §4 ConfigModule, §6 messaging, §7 BullMQ, §8 idempotency, §9 auth, §10 errors and §11 observability are present and largely wired the template way. Most controllers correctly use `@RequirePermission`, `@Idempotent`, `BaseWorkerService` for processors, and `TenantAwareService.forModel()` for tenant-scoped reads/writes. However conformance breaks in several load-bearing areas: **(a)** every Prisma model uses `cuid()` instead of `ulid()` — a non-negotiable platform rule (Pattern Card §13.1–13.2, API Contract §1.2); **(b)** the database health check uses `TypeOrmHealthIndicator` even though the project runs Prisma 7 (§5.1, §22.3); **(c)** `billing.config.ts` / `stripe.config.ts` use class-validator instead of Zod and are not registered in `configLoaders` (§4.4, §4.8); **(d)** several inbound SQS consumers listen on the wrong queue (`CAMPAIGN_SVC_FIFO`, `ANALYTICS_SVC_FIFO`) instead of this service's inbound `TENANT_SVC_FIFO` (§6.18); **(e)** the admin tenant controller has a `TODO: Add admin guards` for endpoints that suspend/unsuspend tenants; **(f)** there is no Ory **Hydra** client even though the service owns OAuth2-client lifecycle per `db_tables` §1 and `system_architecture_v1` line 88. `test-billing.controller.ts` is present in `src/` with no environment gate. No `variant`, `a/b`, or `abtest` references in tenant-svc code — that platform rule is honoured.

Coverage matrix (high level):

| Area | Status |
|------|--------|
| Pattern Card §1 Repo files | 🟡 partial (missing Dockerfile, docker-compose.test.yaml, swcrc.json, renovate.json, .mcp.json, http-client.env.json, buildup.dev.sh, scripts/, full `.claude/rules/*` set) |
| §2 Bootstrap | ✅ (minor: Swagger title hardcoded "Campaign Service API"; no setMaxListeners) |
| §3 AppModule wiring | 🟡 (`JwtAuthGuard` registered in AuthModule, but commented at app.module.ts:54) |
| §4 Config | 🟡 (billing/stripe configs use class-validator, not Zod; not in configLoaders) |
| §5 Database | ✅ DatabaseService; ❌ schema uses cuid() for every PK |
| §6 Messaging | 🟡 (framework present; several consumers point to wrong queues) |
| §7 BullMQ + worker | ✅ |
| §8 Idempotency | ✅ wired; 🟡 some mutating billing endpoints lack `@Idempotent` |
| §9 Auth | 🟡 (Kratos + Keto present; no HydraService) |
| §10 Exceptions | ✅ (raw HttpException still thrown in `tenant.service.ts:96`) |
| §11 Observability | ✅ |
| §12 Validation | ✅ |
| §13 IDs (ulid only) | ❌ schema uses `@default(cuid())` |
| §14 JSON parsing | ✅ |
| §17 Domain structure | ✅ |
| §18 Feature modules | 🟡 (tenant feature splits agnostic/aware; no flat controller) |
| §19 Controllers | 🟡 (no AppLoggerService injection; admin controller no auth) |
| §20 Services | 🟡 (`tenant.service.ts` is 911 LOC) |
| §22 Health | ❌ TypeOrmHealthIndicator in a Prisma project |
| §23 Common subdirs | ✅ |
| §25 Deployment Helm | 🟡 (no values-production.yaml; configmap is `config-map.yaml`) |
| §26 Testing | ❌ (no e2e suites; ~4 unit specs total) |
| §27 Path aliases | ✅ |
| §28 Naming/style | 🟡 (cuid; large files) |
| §29 Git workflow | ✅ |
| §30 Load-bearing | 🟡 (api-key event names use dashes vs spec underscores) |
| Spec coverage (own areas) | 🟡 (missing Users CRUD, Hydra OAuth2-client lifecycle, `GET /internal/validate-token`) |
| Legacy variant/A/B | ✅ none |

---

## 1. Template Pattern Card conformance

### §1 Repo-level files

| # | Item | Status | Evidence / Note |
|---|------|--------|-----------------|
| 1.1 | CLAUDE.md | ✅ | `/CLAUDE.md` |
| 1.2 | README.md | ✅ | `/README.md` |
| 1.3 | TECH_DOC.md | ✅ | `/TECH_DOC.md` |
| 1.4 | package.json engines + preinstall | ✅ | `package.json:7–9,30–34`; ⚠ `name` = `referral-campaign-service` (copy-paste from template) |
| 1.5 | pnpm-workspace.yaml | ✅ |  |
| 1.6 | pnpm-lock.yaml | ✅ |  |
| 1.7 | .npmrc | ✅ |  |
| 1.8 | tsconfig.json | ✅ | strict ES2022 + path aliases |
| 1.9 | tsconfig.build.json | ✅ |  |
| 1.10 | nest-cli.json | ✅ | swc, typeCheck, deleteOutDir |
| 1.11 | swcrc.json | ❌ | **absent** |
| 1.12 | eslint.config.mjs | ✅ |  |
| 1.13 | .prettierrc + .prettierrc.js + .prettierignore | 🟡 | only `.prettierrc` |
| 1.14 | .editorconfig | ✅ |  |
| 1.15 | prisma.config.ts | ✅ |  |
| 1.16 | env.example | 🟡 | `env.example` (11k) AND `.env.example` (9k) — drift risk |
| 1.17 | .env.development / .env.test | ✅ |  |
| 1.18 | .gitignore | ✅ |  |
| 1.19 | .dockerignore | ✅ |  |
| 1.20 | Dockerfile | ❌ | **absent** at repo root |
| 1.21 | docker-compose.test.yaml | ❌ | absent |
| 1.22 | renovate.json | ❌ | absent |
| 1.23 | .mcp.json | ❌ | absent |
| 1.24 | buildup.dev.sh | ❌ | absent |
| 1.25 | http-client.env.json / ingest.http | ❌ | absent |
| 1.26 | .github/ | ✅ | `.github/workflows/` |
| 1.27 | .claude/rules/{architecture,coding-style,git-workflow,testing,performance,agents,security}.md | ❌ | only `.claude/rules/architecture.mdc` (one file, `.mdc` extension) |
| 1.28 | tasks/lessons.md | ❌ | `tasks/` empty before this audit |
| 1.29 | docs/ | ✅ |  |
| 1.30 | scripts/ | ❌ | absent at repo root |
| 1.31 | deployment/ | 🟡 | `helm/` + `local/` present; see §25 |
| 1.32 | test/ | 🟡 | `test/jest`, `test/tenant` (empty), `test/utils`; no e2e suites |

### §2 Bootstrap (`src/main.ts`)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 2.1 | APP_MODE web/worker | ✅ | `main.ts:23` |
| 2.2 | bufferLogs true | ✅ | `main.ts:25` |
| 2.3 | useLogger pino | ✅ | `main.ts:31` |
| 2.4 | setMaxListeners(20) | ❌ | not called |
| 2.5 | enableShutdownHooks | ✅ | `main.ts:32` |
| 2.6 | Worker app.init only | ✅ | `main.ts:34–41` |
| 2.7 | helmet | ✅ | `main.ts:50` |
| 2.8 | compression | ✅ | `main.ts:51` |
| 2.9 | CORS w/ tenant-id, correlation-id, etc. | ✅ | `main.ts:53–67` |
| 2.10 | Global prefix excludes /health, /metrics | ✅ | `main.ts:69–71` |
| 2.11 | URI versioning v1 | ✅ | `main.ts:72` |
| 2.12 | ValidationPipe strict | ✅ | `main.ts:74–81` |
| 2.13 | Swagger gated on !production | ✅ | `main.ts:83–93`; ⚠ title `'Campaign Service API'` hardcoded (line 84) |
| 2.14 | listens app.port | ✅ | `main.ts:95` |
| 2.15 | ConfigService<AllConfigType> | ✅ | `main.ts:26–29,44–46` |
| 2.16 | No dotenv import | ✅ |  |

### §3 AppModule

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 3.1 | ConfigModule.forRoot global + configLoaders + envFilePath | ✅ | `app.module.ts:30–36` |
| 3.2 | configLoaders imported | ✅ | `app.module.ts:6` |
| 3.3 | TerminusModule | ✅ | `app.module.ts:37` |
| 3.4 | CommonModule | ✅ | `app.module.ts:38` |
| 3.5 | DatabaseModule | ✅ | `app.module.ts:39` |
| 3.6 | HealthModule | ✅ | `app.module.ts:40` |
| 3.7 | Feature modules | ✅ | 9 modules |
| 3.8 | APP_FILTER GlobalExceptionsFilter | ✅ | `app.module.ts:53` |
| 3.9 | APP_GUARD JwtAuthGuard then PermissionGuard | 🟡 | line 54 commented out; AuthModule (`auth.module.ts:24–25`) registers both — works, but the dead line is confusing |
| 3.10 | APP_INTERCEPTOR AlsAuthInterceptor | ✅ | `app.module.ts:55` |
| 3.11 | Composition order | ✅ |  |

### §4 ConfigModule

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 4.1 | One file per section | ✅ | 14 files in `src/config/` |
| 4.2 | index.ts exports configLoaders | ✅ | `config/index.ts:28–41` |
| 4.3 | registerAs | ✅ | `app.config.ts:23` |
| 4.4 | Zod + safeParse + fail-fast | 🟡 | True for `app`, `database`, etc. **False** for `billing.config.ts` and `stripe.config.ts` — both use `class-validator` + `validateConfig` |
| 4.5 | Throws on Zod failure | ✅ | most sections |
| 4.6 | Types exported | ✅ |  |
| 4.7 | AllConfigType aggregator | ✅ | `config/config.type.ts` |
| 4.8 | 12 standard namespaces | 🟡 | All 12 declared. **`billingConfig` and `stripeConfig` are in `AllConfigType` (`config.type.ts:35–36`) but NOT in `configLoaders` (`config/index.ts:28–41`)** — `configService.get('billingConfig.*')` returns undefined at runtime. `billing-queue.service.ts:53–55` calls it |
| 4.9 | getOrThrow w/ infer | ✅ |  |
| 4.10 | isWorker from APP_MODE | ✅ | `app.config.ts:30` |

### §5 Database

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 5.1 | DatabaseService extends PrismaClient | ✅ | `database.service.ts:21` |
| 5.2 | @prisma/adapter-pg over pg.Pool | ✅ | `database.service.ts:5–6,29–37` |
| 5.3 | Pool config | ✅ | `database.service.ts:30–33` |
| 5.4 | Client type from generated | ✅ | `database.service.ts:3` |
| 5.5 | log gated on dbConfig.logging | ✅ | `database.service.ts:39` |
| 5.6 | onModuleInit $connect | ✅ | `database.service.ts:43–45` |
| 5.7 | $transaction override | ✅ | `database.service.ts:54–63` |
| 5.8 | DatabaseModule @Global | ✅ | `database.module.ts:1–9` |
| 5.9 | TenantAwareService.forModel | ✅ | used by api-key, team-member, invitation, tenant-setting services |
| 5.10 | Soft-delete | ✅ | inherited from TenantAwareService |
| 5.11 | withTenantFilter | ✅ |  |
| 5.12 | prismaPaginate | ✅ | each feature has `*.pagination.ts` |
| 5.13 | Schema in `src/prisma/schema/*.prisma` | ✅ | 11 files |
| 5.14 | Generator prisma-client + output ../generated | ✅ | `schema.prisma:7–10` |
| 5.15 | Migrations + seed | ✅ |  |
| 5.16 | @prisma-gen/* alias | ✅ | `tsconfig.json:44` |
| — | **ID strategy `ulid()`** | ❌ | Every Prisma model uses `@default(cuid())`: `tenant.prisma:2`, `api-key.prisma:2`, `billing.prisma:2,21,45,65`, `invitation.prisma:2`, `file.prisma:2`, `tenant-setting.prisma:2,21`, `team-member.prisma:2`, `side-effect-outbox.prisma:9`. Pattern Card §13 + API Contract §1.2 mandate ULIDs (26-char Crockford Base32). |

### §6 Messaging

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 6.1–6.7 | SideEffectService outbox + worker | ✅ | `common/side-effects/` |
| 6.8–6.13 | MessageEnvelopeService | ✅ |  |
| 6.14–6.15 | SqsProducer, SnsPublisher | ✅ | `common/messaging/` |
| 6.16–6.17 | MessagingModule.forRoot | ✅ | `common/common.module.ts:38` |
| 6.18 | Listener pattern (services emit, listeners side-effect) | ✅ | `features/api-key/listeners/api-key.listener.ts:23,37,63,88,113` calls `sideEffectService.createSqsSideEffect`; services use `txEventEmitter.emitAfterCommit` (`api-key.service.ts:84–85`) |
| 6.19 | Listener naming kebab-case | ✅ | 9 files in `common/events/listeners/` |
| 6.20 | EventsModule providers | ✅ |  |
| 6.21 | EventEmitterModule.forRoot | ✅ |  |
| 6.22 | emitAfterCommit | ✅ |  |
| — | **Inbound SQS queue routing** | ❌ | `features/tenant/listeners/tenant-events.consumer.ts:28–29` consumes `CAMPAIGN_SVC_FIFO`; `features/billing/listeners/referral-events.consumer.ts:5,27–29` consumes `ANALYTICS_SVC_FIFO`. Per `system_architecture_v1` and §30.1 the inbound queue for this service is `TENANT_SVC_FIFO`. Both consumers would steal messages from sibling services in production. |

### §7 BullMQ + worker mode

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 7.1 | APP_MODE | ✅ | `main.ts:23`, `app.config.ts:30` |
| 7.2–7.11 | BullJobsService, BaseWorkerService | ✅ | `common/bulljobs/`; processors extend `BaseWorkerService` (`tenant-deletion.processor.ts:17`, `tenant-unlock.processor.ts:20`, `billing-usage.processor.ts:31`, `dlq-replay-worker.service.ts:35`, `outbox-worker.service.ts:42`) |
| 7.12 | Recurrent jobs scheduled in worker | ✅ | `billing-queue.service.ts:23–82` |
| 7.13 | No `@Cron` / `@nestjs/schedule` direct usage | 🟡 | `@nestjs/schedule@^6.1.1` is in `dependencies` (`package.json:55`); zero direct usage in `src/` — dead dependency, should be removed |
| 7.14 | worker-deployment APP_MODE=worker | ✅ | `worker-deployment.yaml:43–46` |

### §8 Idempotency

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 8.1 | Layer 1 SQS FIFO dedup | ✅ | sqs-producer same as template |
| 8.2 | Layer 2 Redis 24h | ✅ | `common/idempotency/idempotency.service.ts` |
| 8.3 | Layer 3 DLQ replay | ✅ | `common/messaging/dlq-{consumer,replay-worker}.service.ts` |
| 8.4 | Business-domain keys | 🟡 | services rely on envelope-level idempotency; not always explicit |
| 8.6 | `@Idempotent` on mutations | 🟡 | Present on `api-key.controller.ts:37,77,94`, `team-member.controller.ts:36,76`, `invitation.controller.ts:51,110,147`. **Missing** on every billing mutation (`billing.controller.ts:38,56,64,72,88,96,118,142`) and on `agnostic-tenant.controller.ts:54` (`POST /v1/tenants` create) |
| 8.7 | IdempotencyInterceptor global | ✅ | `common/idempotency/idempotency.module.ts:68–69` |

### §9 Auth

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 9.1 | AuthModule @Global + PassportModule | ✅ | `common/auth/auth.module.ts:21` |
| 9.2 | JwtStrategy via JWKS | ✅ | `common/auth/jwt.strategy.ts` |
| 9.3 | JwtAuthGuard w/ @Public | ✅ |  |
| 9.4 | JwtAuthGuard APP_GUARD | ✅ | `auth.module.ts:24` |
| 9.5 | KratosService | ✅ |  |
| 9.6 | KetoService.check | ✅ | `keto.service.ts:32–60` |
| 9.7 | PermissionGuard reads `@RequirePermission` | ✅ | `permission.guard.ts:14–57` |
| 9.8 | PermissionGuard after JwtAuthGuard | ✅ | `auth.module.ts:24–25` |
| 9.9 | `@RequirePermission(...)` shape | 🟡 | tenant-svc uses object form `{namespace,object,relation}` (e.g. `api-key.controller.ts:34`); Card §9.7 string form `'namespace:relation'`. Drift — pick one platform-wide |
| 9.10 | `@Public()` | ✅ |  |
| 9.11 | `@CurrentUser()` | ✅ | `api-key.controller.ts:42` |
| 9.12 | TenantApiKeyGuard | ✅ | declared but unused in controllers |
| 9.13–9.14 | AlsAuthInterceptor global | ✅ | `app.module.ts:55` |
| 9.15 | keto.constants.ts | ✅ |  |
| — | **HydraService for OAuth2 clients** | ❌ | No `hydra.service.ts`. Per `system_architecture_v1` line 88 + `db_tables_per_service` §1, tenant-svc owns Hydra OAuth2 client lifecycle. Dashboard SPA/M2M clients cannot be provisioned |

### §10 Errors

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 10.1–10.5 | BaseException + filter | ✅ | `common/exceptions/` |
| 10.6 | Prisma error mapping | ✅ |  |
| 10.7–10.10 | requestId/correlationId, no stacks to clients | ✅ |  |
| — | Raw HttpException in services | 🟡 | `tenant.service.ts:96–104` throws `new HttpException(...)` instead of a `BaseException` subclass — RFC 9457 mapping is bypassed |

### §11 Observability — ✅
### §12 Validation — ✅ (except billing/stripe config Zod gap; see §4.4)

### §13 IDs

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 13.1 | `ulid` package used | 🟡 | Used in message envelope. **Entity IDs are not ULID** (see §5) |
| 13.2 | No `uuid()` | 🟡 | one match in `common/mock/prismaorm-faker/faker-helpers.ts:102` (test faker — tolerable) |
| 13.3 | Ulid branded type | ✅ |  |

### §14 JSON parsing — ✅
### §15 HTTP client — ✅
### §16 Resilience — ✅

### §17 Domain structure

✅ Each domain (`tenant`, `api-key`, `team-member`, `billing`) has `dto/`, `mappers/`, `responses/`, `events/`, `<entity>.types.ts`, `index.ts`. ⚠ `domains/campaign/` and `domains/referral/` exist — template leftovers; tenant-svc doesn't own these.

### §18 Feature modules

| Item | Status | Evidence |
|------|--------|----------|
| One feature per entity, kebab-case | ✅ |  |
| `<entity>.module.ts`, controller, service, pagination | 🟡 | tenant feature: no flat `tenant.controller.ts` / `tenant.pagination.ts`. Splits into `agnostic/` (admin/no-tenant-context) + `aware/` (tenant-scoped). Pragmatic but non-standard — document |
| api-key sub-dirs | 🟡 | has `middleware/` — Card sanctions only `processors/` (and listeners/guards in this repo) |
| billing complexity | 🟡 | 8 services + 6 controllers in one feature — should split into subscriptions, plans, usage, webhooks per SRP |

### §19 Controllers

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 19.1 | `@Controller({ path, version: '1' })` | ✅ |  |
| 19.2 | `@ApiTags` | ✅ |  |
| 19.3 | `@ApiHeader('x-tenant-id'...)` | 🟡 | `api-key.controller.ts:20–25` uses `x-tenant-id`; `aware-tenant.controller.ts:45–50` uses `tenant-id` (no `x-`). Inconsistent |
| 19.4 | AppLoggerService injection + setContext | ❌ | **No controller in tenant-svc injects AppLoggerService**. Checked: api-key, billing, aware-tenant, agnostic-tenant — none. Logs unscoped |
| 19.5 | `@Body() dto` | ✅ |  |
| 19.6 | `@RequirePermission` | 🟡 | Missing on `agnostic-tenant.controller.ts:48–58` (`POST /v1/tenants`) and **every method** of `admin-tenant.controller.ts:14–29`. Literal `// TODO: Add admin guards` on line 12 — suspend/unsuspend currently unauthenticated |
| 19.7 | `@Idempotent` on mutations | 🟡 | see §8.6 |
| 19.8 | HttpCode CREATED/OK | ✅ |  |
| 19.9 | Swagger response decorators | ✅ |  |
| 19.10 | `@Paginate()` + `Paginated<T>` | ✅ | `api-key.controller.ts:54–58` |
| 19.11 | Delegate to service | ✅ |  |
| 19.12 | File upload | ✅ | `agnostic-tenant.controller.ts:48–58` |

### §20 Services

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 20.1 | DI of TenantAwareService, TenantContextService, AppLoggerService | ✅ | `api-key.service.ts:35`, etc. |
| 20.2 | setContext | ✅ | `tenant.service.ts:71` |
| 20.3 | tenant-scoped Prisma getter | ✅ | `api-key.service.ts:45`, `team-member.service.ts:44`, `invitation.service.ts:50`, `tenant-setting.service.ts:41` |
| 20.4 | SIMPLE/OUTBOX/EMIT patterns | ✅ | EMIT widely used; OUTBOX not heavily exercised |
| 20.5 | Cache-aside reads | (not verified) |
| 20.6 | prismaPaginate on lists | ✅ |  |
| 20.7 | Soft delete | ✅ |  |
| 20.8 | Only HttpClientService for sync HTTP | ✅ | no `axios`/`fetch` in feature code |
| 20.9 | NestJS NotFound / BaseException | 🟡 | `tenant.service.ts:96` raw `HttpException` |
| 20.10 | No HTTP concerns | ✅ |  |
| — | Service size | ❌ | `tenant.service.ts` 911 LOC (Card §28.13 target <100). Effectively a god class spanning create/update/suspend/lock/unlock/schedule-deletion/cancel-deletion/transfer-ownership/domain-verification/profile/stats |

### §21 Repositories — ✅ (implicit via TenantAwareService.forModel)

### §22 Health

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 22.1 | `@Controller('health')` + `@Public()` | ✅ | `health.module.ts:18–20` |
| 22.2 | `/health/live` heap-only | ✅ | `health.module.ts:32–34` |
| 22.3 | `/health/ready` db + redis | ❌ | `health.module.ts:39–41` uses `this.db.pingCheck('database')` where `this.db` is `TypeOrmHealthIndicator` (imported line 11, injected line 22). The project uses Prisma 7, not TypeORM. Either the injection fails at boot or silently no-ops |
| 22.4 | `/health` compound | ❌ | same issue, line 44 |
| 22.5 | `/health/circuit-breakers` | ✅ | lines 54–73 |
| 22.6 | RedisHealthIndicator | ✅ |  |
| 22.7 | TerminusModule | ✅ |  |
| 22.8 | Routes excluded from prefix + autoLogging | ✅ |  |

### §23 Common subdirs

All 26 subdirs from Card §23 present; `CommonModule` order matches (`common.module.ts:28–67`). ✅

### §24 Config files

| # | Item | Status | Note |
|---|------|--------|------|
| 24.1 | One file per section | ✅ |  |
| 24.2 | Zod safeParse fail-fast | 🟡 | billing & stripe use class-validator |
| 24.3 | env.example documents every var | 🟡 | two example files (drift) |
| 24.4 | Helm updated for new vars | 🟡 | only one values.yaml |
| 24.5 | prisma.config.ts cascading | ✅ |  |
| 24.6 | `.env.test` consumed | 🟡 | no `prisma:migrate:test` script |

### §25 Deployment Helm

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 25.1 | Chart + values + values-production | 🟡 | `values-production.yaml` absent |
| 25.2 | 15 templates | 🟡 | All present, but `config-map.yaml` (hyphenated) vs Card's `configmap.yaml` |
| 25.3 | worker-deployment APP_MODE=worker | ✅ | `worker-deployment.yaml:43–46` |
| 25.4 | migration-job runs prisma migrate deploy | ✅ |  |
| 25.5 | servicemonitor.yaml | ✅ |  |
| 25.6 | local docker-compose.yaml | ✅ |  |
| 25.7 | GH Actions deploy | ✅ |  |

### §26 Testing

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 26.1 | Jest config | (not re-verified) |
| 26.2 | jest-e2e.json | ✅ |  |
| 26.3 | Naming | ✅ where tests exist |
| 26.4 | E2E spins up Docker Compose | ❌ | no docker-compose.test.yaml, no `test:e2e:docker` script |
| 26.5 | `test/jest/*` scaffolding | 🟡 | only `test-setup.ts`, `test-teardown.ts` |
| 26.6 | Sample e2e suites | ❌ | `test/tenant/` empty; no `*.e2e-spec.ts` |
| 26.7 | Real PG/Redis/LocalStack | ❌ |  |
| 26.8 | Test builders | ✅ | `common/mock/` |
| 26.9 | Coverage scripts | 🟡 | no `test:e2e:docker` |
| 26.10 | 80% coverage | ❌ | only 4 `*.spec.ts` in `src/` |

### §27 Path aliases — ✅

### §28 Naming and style

| # | Status | Note |
|---|--------|------|
| 28.1–28.2 | ✅ | strict + ES2022 |
| 28.3–28.5 | ✅ |  |
| 28.6 | (not verified) |  |
| 28.7 | ✅ | `I`-prefixed interfaces |
| 28.8–28.12 | ✅ |  |
| 28.13 | ❌ | `tenant.service.ts` 911 LOC; `billing.service.ts` very large |
| 28.14 | 🟡 | No `@Cron` direct usage; `@nestjs/schedule` is unused dead dependency |

### §29 Git workflow — ✅

### §30 Load-bearing

| # | Status | Note |
|---|--------|------|
| 30.1 | ✅ | queue/topic constants in `types/app.type.ts:445–553`; tenant queues defined |
| 30.2 | ✅ | typed event types |
| 30.3 | ✅ | branded types |
| 30.4 | ✅ | RequestContext |
| 30.5 | ✅ |  |
| 30.6 | ✅ |  |
| 30.7 | ✅ | express.d.ts |
| 30.8 | ✅ |  |
| 30.9 | ✅ | Environment enum |
| 30.10 | ❌ | `tasks/lessons.md` absent |
| 30.11 | 🟡 | only `architecture.mdc` (single file, `.mdc` ext) |
| 30.12 | ✅ |  |
| 30.13–30.16 | (not re-verified) |  |
| 30.17 | ✅ | BaseDomainEvent used |
| 30.18 | ✅ | BroadcastEvent + listener |
| 30.19 | ✅ | RulesEngineModule |
| 30.20 | 🟡 | ClickHouseConfig declared but tenant-svc has no analytics ownership |
| 30.21 | ✅ | SesService |
| 30.22 | (not re-verified) |  |
| 30.23 | ✅ | @Idempotent + interceptor |
| 30.24 | ✅ |  |
| 30.25 | ✅ | only-allow pnpm preinstall |

---

## 2. Spec coverage (tenant-svc ownership only)

Owned per `db_tables_per_service` §1 + `system_architecture_v1` lines 80–90: tenants, users, roles, api_keys, oauth2_clients (Hydra), sessions (Kratos), Keto tuples. Plus billing/subscriptions/plans (this repo's BILLING.md).

### Tenants
- ✅ `tenants` table (`prisma/schema/tenant.prisma`) with rich lifecycle columns (status, paymentStatus, trialStartedAt/EndsAt, suspendedAt, lockedAt, lockUntil, lockReason, deletionScheduledAt/Reason, customDomain, domainVerificationStatus/Token).
- ❌ `id` uses `cuid()` instead of ULID (db_tables §1 explicitly says `id (ULID)`).
- ✅ Lifecycle endpoints: create (`agnostic-tenant.controller.ts`), profile/update/lock/unlock/transfer-ownership/schedule-deletion (`aware-tenant.controller.ts`), suspend/unsuspend (`admin-tenant.controller.ts`).
- ❌ `admin-tenant.controller.ts:12` literal `TODO: Add admin guards` — suspend/unsuspend currently unauthenticated.
- ✅ Domain events: `TenantCreatedEvent`, `TenantUpdatedEvent`, `TenantDeletedEvent`, `TenantSuspendedEvent`, `TenantUnsuspendedEvent`, `TenantLockedEvent`, `TenantUnlockedEvent`, `TenantDeletionScheduledEvent`, `TenantDeletionCancelledEvent`, `TenantOwnershipTransferredEvent`, `TenantDomainVerifiedEvent` (`domains/tenant/events/tenant.events.ts`). Richer than spec event model §4.12.

### Users
- ❌ No `users` table in `prisma/schema/`. Spec §1 mandates one with `kratos_identity_id`, `role`, `last_login_at`. `TeamMember` (`team-member.prisma`) plays part of this role but is membership, not identity.
- ❌ No `/v1/users/me`, `/v1/users/{id}/roles` endpoints (API contract §2.3 implies these exist).
- 🟡 `domains/user/events/user.events.ts` declares user.created/updated/deleted events but no service emits them in the tenant feature.

### Roles
- ❌ No `roles` / `user_roles` tables. Likely intentional (Keto tuples replace SQL role tables) but spec also lists role definitions table. Flag for spec clarification.

### API keys
- ✅ `api_keys` table (`prisma/schema/api-key.prisma`).
- ✅ Full CRUD endpoints (`api-key.controller.ts`).
- ✅ Permissions via `@RequirePermission`.
- ✅ Events emitted (`api-key.service.ts:84–85`).
- 🟡 Event names use dashes (`api-key.created`); spec event model §4.12 uses underscores (`api_key.created`).
- 🟡 No clear distinction between `rai_live_` vs `rai_pub_` types in feature code (need `api-key.types.ts` inspection).
- ❌ **No `GET /internal/validate-token`** endpoint (`system_architecture_v1` line 84/174). Every other service depends on this gateway-facing endpoint.

### Ory Kratos identities
- ✅ `KratosService` (`common/auth/kratos.service.ts`) wraps admin API.
- 🟡 Identity creation occurs via Kratos webhook (`webhook.controller.ts:20 handleOrySignup`) — `@Public()` and protected only by `x-ory-api-key` header. Verify replay protection + secret rotation.
- ⚠ `KratosService.adminUrl` falls back to hardcoded `'http://kratos:4434'` (`kratos.service.ts:19`) — should fail-fast if config missing.

### Ory Hydra OAuth2 clients
- ❌ **No HydraService.** No `oauth2_clients` Prisma table. Per `db_tables_per_service` §1 + `system_architecture_v1` line 88, tenant-svc owns Hydra OAuth2 client lifecycle (dashboard SPA + M2M). Currently unimplemented.

### Ory Keto permissions
- ✅ `KetoService` (`keto.service.ts`) supports `check`, `createTuple`, `deleteTuple`.
- ✅ `tenant.service.ts` grants owner CRUD across `KetoResource.MEMBER/INVITATION/API_KEY/BILLING/PLANS/SETTINGS` at tenant create.
- ✅ `keto.constants.ts` defines namespaces/resources/relations.

### Billing / subscriptions
- ✅ Tables: `Billing`, `BillingEvent`, `Plan`, `TenantUsage` (`billing.prisma`).
- ✅ Services: BillingService, StripeService, PlanService, PlanLimitService, PlanStripeSyncService, UsageTrackerService, DailyUsageCalculator, MonthlyUsageResetService, PaymentStatusEscalationService, TrialLifecycleService.
- ✅ Repeatable jobs via BullMQ (`billing-queue.service.ts`).
- ✅ Stripe webhook (`webhooks.controller.ts:14`).
- ❌ `test-billing.controller.ts` exposes `POST /test/stripe/checkout-session` and force-reset endpoints with **no env gate**.
- ❌ Billing controllers lack `@Idempotent` on financial mutations.
- ❌ `billing.config.ts` + `stripe.config.ts` not in `configLoaders` — runtime breakage waiting.

### Tenant lifecycle
- ✅ Signup via Kratos webhook → `tenantService.create()`.
- ✅ Trial dates set on create (`tenant.service.ts:109–117`).
- ✅ Trial lifecycle worker (`trial-lifecycle.service.ts`).
- ✅ Suspension via admin controller (unguarded).
- ✅ Scheduled deletion via BullMQ + `TenantDeletionProcessor`.
- ✅ Lock/unlock via BullMQ + `TenantUnlockProcessor`.

### Inbound SQS consumers
- ❌ Tenant-svc should consume on `TENANT_SVC_FIFO`. Two consumers point elsewhere:
  - `features/tenant/listeners/tenant-events.consumer.ts:28–29` → `CAMPAIGN_SVC_FIFO`.
  - `features/billing/listeners/referral-events.consumer.ts:27–29` → `ANALYTICS_SVC_FIFO`.
  Both will steal messages destined for sibling services.

---

## 3. Legacy variant / A/B naming findings

`grep -rn -i "variant\|a/b\|abtest\|ab_test\|ab[-_]test"` across `src/` returned **zero** matches. The "no Variant entity, no A/B testing" platform rule is honoured.

---

## 4. Out of scope

Owned by other services and correctly absent here:
- Programs, Campaigns, Variants → campaign-svc
- Segments, eligibility → segmentation-svc
- Event ingestion → ingestion-svc
- Referrals, links, attribution → referral-svc
- Rewards, payouts → reward-svc
- KPIs, ClickHouse OLAP → analytics-svc
- Webhook delivery, email retry → notification-svc
- Fraud scoring, LangChain → ai-svc

Note: `domains/campaign/` and `domains/referral/` exist in tenant-svc — template fork leftovers; should be deleted.

---

## 5. Top 10 priorities

1. **Switch every Prisma `@default(cuid())` to ULID.** All schema files. Pattern Card §13 + API Contract §1.2. Either via a Postgres ULID extension `@default(dbgenerated("..."))` or by populating `id` in application code (`ulid()`) before insert.
2. **Fix `health.module.ts`** — replace `TypeOrmHealthIndicator` with a Prisma-based indicator (custom `await prisma.$queryRaw\`SELECT 1\`` or `PrismaHealthIndicator`). Card §22.3–22.4.
3. **Register `billingConfig` + `stripeConfig` in `configLoaders` and rewrite both with Zod.** Card §4.4 + §4.8. Currently `configService.get('billingConfig.*')` returns `undefined`.
4. **Re-point SQS consumers to `TENANT_SVC_FIFO`.** `features/tenant/listeners/tenant-events.consumer.ts:28–29`; `features/billing/listeners/referral-events.consumer.ts:27–29`.
5. **Add real auth guards to `AdminTenantController`** (`admin-tenant.controller.ts:12`) and add `@RequirePermission` to `AgnosticTenantController.create` (`agnostic-tenant.controller.ts:54`). Suspend/unsuspend + create tenant currently unauthenticated.
6. **Add a HydraService + `oauth2_clients` table + endpoints** for OAuth2 client lifecycle (`system_architecture_v1` line 88; `db_tables_per_service` §1).
7. **Add `GET /internal/validate-token`** so the gateway can resolve API keys + JWTs to internal JWT (`system_architecture_v1` line 84/174).
8. **Gate `test-billing.controller.ts` behind `nodeEnv !== 'production'`** or remove from `src/`. Currently exposes Stripe checkout + force-reset in any deployment.
9. **Add `@Idempotent` to billing mutating endpoints** (`billing.controller.ts:38,56,64,72,88,96,118,142`) and to `agnostic-tenant.controller.ts:54` (create).
10. **Split `tenant.service.ts` (911 LOC) into focused services** — `TenantLifecycleService`, `TenantDeletionService`, `TenantDomainService`, `TenantStatsService` (already extracted). Object Calisthenics §28.13.

Honourable mentions: align `@RequirePermission` syntax with Card §9.7; fix Swagger title in `main.ts:84`; add `setMaxListeners(20)` in `main.ts`; remove `// { provide: APP_GUARD, useClass: JwtAuthGuard }` (`app.module.ts:54`); create proper `.claude/rules/*.md` set; add `tasks/lessons.md`; add Dockerfile, docker-compose.test.yaml, values-production.yaml; remove dead `domains/campaign/` and `domains/referral/`; remove unused `@nestjs/schedule` dep; switch `tenant.service.ts:96` to a `BaseException` subclass; replace hardcoded Kratos URL fallback with config fail-fast; rename `api-key.*` events to `api_key.*` to match spec event model.

---

## 6. Anomalies / surprises

- **Package name `referral-campaign-service`** (`package.json:2`) and Swagger title `Campaign Service API` (`main.ts:84`) — repo was forked from campaign-svc; cosmetic identity strings never updated.
- **Two env example files** (`env.example` 11k + `.env.example` 9k) — drift risk; pick one.
- **`domains/campaign/` and `domains/referral/`** present in tenant-svc — template leftovers; should be deleted.
- **`ClickHouseConfig`** declared though tenant-svc has no analytics responsibilities. Harmless but adds boot deps.
- **`@nestjs/schedule@^6.1.1`** in `dependencies` (`package.json:55`) but zero direct usage. Dead dep.
- **`TenantApiKeyGuard`** exists in `common/auth/` but isn't used by any controller. If internal endpoints (like `validate-token`) get added, this is the intended mechanism.
- **`WebhookController` (singular) + `WebhooksController` (plural)** coexist in `webhook.module.ts:1–7` mounted at `/v1/webhook` and `/v1/webhooks` respectively (the latter `VERSION_NEUTRAL`). Confusing; merge or document.
- **`internal-tenant-status.controller.ts`** in billing feature — name implies "internal" but no visible gate.
- **`stripe-redirect.controller.ts`** — verify CSRF/state handling for redirect flows.
- **`api-key.created` (dash) vs spec `api_key.created` (underscore)** — naming convention mismatch with event model.
- **`KratosService.adminUrl`** silently falls back to hardcoded `'http://kratos:4434'` (`kratos.service.ts:19`) — should fail-fast via Zod.
- **`api-key.controller.ts:62`** `@RequirePermission` has no `object` field — possible privilege over-grant; review against Keto tuples.
- **`tenant.service.ts:96–104`** throws raw `HttpException` for `SUBDOMAIN_UNAVAILABLE` — should be a `BaseException` subclass for consistent RFC 9457 mapping.
- **No `oauth2_clients` model** even though spec declares ownership.
- **`test/tenant/` is empty** — committed placeholder; tenant-svc has near-zero automated test coverage (4 `*.spec.ts` total in `src/`).
- **`TenantStatusGuard` + `TenantLockGuard`** are applied as `@UseGuards(...)` on `AwareTenantController` (`aware-tenant.controller.ts:51`) — good defensive pattern; document in CLAUDE.md.

End of audit.
