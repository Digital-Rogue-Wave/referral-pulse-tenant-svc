---
name: nestjs-api
description: This skill provides patterns and templates for NestJS 11.x with Express, Prisma ORM, and TypeScript 5.x development. It should be activated when creating NestJS modules, controllers, services, Dtos, guards, interceptors, or tests.
allowed-tools: Bash, Read, Write, Edit
---

# NestJS 11.x + Express + Prisma REST API Skill

## Conventions & Rules

> For code conventions, package layout, NestJS rules, Prisma 7.x rules, and environment file rules, read `reference/nestjs-conventions.md`

## Process

1. **Scaffold** clone git@github.com:Digital-Rogue-Wave/referral-pulse-svc-template.git
2. **Configure** package.json and tsconfig — read `reference/nestjs-config-basics.md` and `reference/nestjs-config-pnpm-ts.md`
3. **Follow conventions** — read `reference/nestjs-conventions.md` for package layout and NestJS rules
4. **Write tests** with Jest + supertest or NestJS Testing utilities
5. **Format and check**: `pnpm lint && pnpm typecheck`

## Key Patterns

| Pattern | Implementation |
|---------|---------------|
| **Modules** | `@Module()` with imports/providers/exports, aggregation pattern |
| **Controllers** | `@Controller('api/v1/...')` with route decorators |
| **Services** | `@Injectable()` with constructor injection |
| **DTOs** | Classes with `class-validator` decorators (`@IsString()`, `@IsNotEmpty()`) |
| **Repositories** | Prisma Client via `DatabaseService` wrapper |
| **Error handling** | `@Catch()` exception filter returning `ProblemDetail` (RFC 9457) |
| **Config** | Fail-fast `registerAs()` with static config reader |
| **Migrations** | Prisma Migrate in `prisma/migrations/` |
| **Background Jobs** | BullMQ: QueueService (schedules) → Processor (dispatches) → Domain Service (logic) |
| **Guards** | `@UseGuards()` for auth (`JwtAuthGuard`, `RolesGuard`) |
| **Interceptors** | `LoggingInterceptor`, `TransformInterceptor` (global) |
| **Pipes** | Global `ValidationPipe` with whitelist and transform |

## Reference Files

| File                                               | Content                                                               |
|----------------------------------------------------|-----------------------------------------------------------------------|
| `reference/nestjs-conventions.md`                  | Code conventions, package layout, NestJS rules, Prisma 7.x rules     |
| `reference/nestjs-config-basics.md`                | Static config reader, config module aggregation, fail-fast validation |
| `reference/nestjs-config-pnpm-ts.md`               | package.json with dependencies, tsconfig.json                         |
| `reference/nestjs-enterprise-patterns.md`          | Exception hierarchy, validation pipe, API versioning                  |
| `reference/nestjs-enterprise-infrastructure.md`    | Health checks, ALB, graceful shutdown, Swagger, K8s/Docker            |
| `reference/nestjs-resilience-circuit-breaker.md`   | Circuit breaker (opossum), LRU cache, state management                |
| `reference/nestjs-resilience-context.md`           | Request context with AsyncLocalStorage, AlsAuthInterceptor            |
| `reference/nestjs-event-driven-side-effects.md`    | SideEffectService, outbox pattern, event listeners, SQS/SNS           |
| `reference/nestjs-mapper.md`                       | Mapping of json objects from and to DTOs                              |
| `reference/nestjs-observability.md`                | OpenTelemetry tracing/metrics, structured logging, cloud logging      |
| `reference/nestjs-bulljobs.md`                     | BullMQ worker/cron pattern: QueueService + Processor + Domain Service |
| `reference/nestjs-clickhouse.md`                   | ClickHouse analytics, MergeTree schemas, batch ingestion              |
| `reference/nestjs-rest-dto-pagination.md`          | DTO mapping, pagination, filter patterns                              |
| `reference/nestjs-debugging-logging.md`            | Debug mode, Prisma query logging, request lifecycle                   |
| `reference/nestjs-debugging-context-di.md`         | AsyncLocalStorage context, DI debugging, config                       |
| `reference/nestjs-debugging-performance.md`        | Memory leaks, performance profiling, circuit breaker debugging        |
| `reference/nestjs-debugging-production.md`         | Production debugging, structured logging, tracing                     |
| `reference/nestjs-review-checklist.md`             | Security review checklist (Ory Kratos/Hydra/Keto)                     |
| `reference/nestjs-idempotency.md`                  | Idempotency guide: HTTP + SQS deduplication, IdempotencyService       |
| `reference/nestjs-idempotency-keys.md`             | Idempotency key best practices: business-domain keys, NOT ULID/UUID   |
| `reference/nestjs-performance-optimizations.md`    | simdjson JsonService, Redis/SQS parsing, benchmarks, OTel metrics     |

## Documentation Sources

**MANDATORY**: Before generating code that uses any library API, check the latest documentation. Never rely on training data for API signatures, config options, or method names — they may be outdated or wrong.

| Source | URL / Tool | Purpose |
|--------|-----------|---------|
| Prisma ORM | `https://www.prisma.io/docs/llms.txt` | Prisma schema, migrations, client API |
| NestJS / TypeScript | `Context7` MCP | Latest NestJS decorators, modules, patterns |
| Any other library | `Context7` MCP | Always verify before using |

If Context7 has no result for a library, say so — do not guess the API.

## Error Handling

**Validation errors**: Use `class-validator` decorators on DTO classes. Global ValidationPipe auto-returns 422 with details.

**Not-found errors**: Throw `NotFoundException` from services. Global exception filter returns structured 404.

**Duplicate errors**: Catch Prisma `P2002` unique constraint violation and convert to `409 Conflict`.
