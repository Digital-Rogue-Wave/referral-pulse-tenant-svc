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
2. **Configure** package.json and tsconfig — read `reference/nestjs-config-basics.md`, `reference/nestjs-config-pnpm-ts.md`, and `reference/nestjs-config-prisma7.md`
3. **Create files** using templates — read `reference/nestjs-templates-core.md` for main.ts, AppModule, CoreModule; read `reference/nestjs-templates-features.md` for feature modules, controllers, services, Dtos
4. **Follow conventions** below for package layout and NestJS rules
5. **Write tests** with Vitest + supertest or NestJS Testing utilities
6. **Format and check**: `pnpm lint && pnpm typecheck`

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
| `reference/nestjs-config-basics.md`                | Static config reader, config module aggregation, fail-fast validation |
| `reference/nestjs-config-pnpm-ts.md`               | package.json with dependencies, tsconfig.json                         |
| `reference/nestjs-config-prisma7.md`               | Prisma 7.x schema, prisma.config.ts, PrismaService, .env template     |
| `reference/nestjs-templates-core.md`               | main.ts, app.module, core.module templates                            |
| `reference/nestjs-templates-features.md`           | Feature module, controller, service, Dto templates                    |
| `reference/nestjs-enterprise-patterns.md`          | Exception hierarchy, validation pipe, API versioning                  |
| `reference/nestjs-enterprise-infrastructure.md`    | Security middleware (Helmet), rate limiting, Swagger, health checks   |
| `reference/nestjs-resilience-circuit-breaker.md`   | Circuit breaker, retry, timeout, database fallback                    |
| `reference/nestjs-resilience-context.md`           | Request context with AsyncLocalStorage, correlation IDs               |
| `reference/nestjs-mapper.md`                       | Mapping of json objects from and to Dtos                              |
| `reference/nestjs-feature-flags.md`                | Feature flags service, Redis fallback, gradual rollout                |
| `reference/nestjs-observability.md`                | OpenTelemetry tracing/metrics, structured logging, cloud logging      |
| `reference/nestjs-bulljobs.md`                     | BullMQ worker/cron pattern: QueueService + Processor + Domain Service |
| `reference/nestjs-messaging-basics.md`             | BullMQ queues, background job processing                              |
| `reference/nestjs-messaging-queues.md`             | RabbitMQ reliable messaging, dead letter queues                       |
| `reference/nestjs-messaging-streaming.md`          | Kafka event streaming, high-throughput patterns                       |
| `reference/nestjs-testing-unit-basics.md`          | Unit testing with Vitest, service test patterns                       |
| `reference/nestjs-testing-unit-controllers.md`     | Controller unit tests, test data factories                            |
| `reference/nestjs-testing-unit-mocks.md`           | Prisma/Redis/HTTP mocking, ConfigService mocking                      |
| `reference/nestjs-testing-integration-setup.md`    | E2E testing setup, Testcontainers, supertest                          |
| `reference/nestjs-testing-integration-patterns.md` | Auth testing, validation, pagination patterns                         |
| `reference/nestjs-testing-patterns.md`             | Circuit breaker testing, AsyncLocalStorage testing                    |
| `reference/nestjs-testing-ci-troubleshooting.md`   | Coverage standards, CI/CD, troubleshooting                            |
| `reference/nestjs-rest-workflow.md`                | REST workflow, OpenAPI/Swagger controller setup                       |
| `reference/nestjs-rest-dto-pagination.md`          | Dto mapping, pagination, filter patterns                              |
| `reference/nestjs-rest-upload-errors.md`           | File uploads, API versioning, ProblemDetail errors                    |
| `reference/nestjs-rest-services.md`                | Service patterns, external API clients, bulk operations, soft delete  |
| `reference/nestjs-security-auth.md`                | JWT authentication (RS256), password hashing, token management        |
| `reference/nestjs-security-scanning.md`            | OWASP scanning, security headers, static analysis                     |
| `reference/nestjs-security-validation-logging.md`  | Input validation, PII masking, Prisma security                        |
| `reference/nestjs-debugging-logging.md`            | Debug mode, Prisma query logging, Fastify lifecycle                   |
| `reference/nestjs-debugging-context-di.md`         | AsyncLocalStorage context, DI debugging, config                       |
| `reference/nestjs-debugging-performance.md`        | Memory leaks, performance profiling                                   |
| `reference/nestjs-debugging-production.md`         | Production debugging, structured logging, tracing                     |
| `reference/nestjs-review-checklist.md`             | NestJS review checklist (used by `nestjs-reviewer` agent)             |

## Documentation Sources

Before generating code, consult these sources for current syntax and APIs:

| Source | URL / Tool | Purpose |
|--------|-----------|---------|
| Prisma ORM | `https://www.prisma.io/docs/llms.txt` | Prisma schema, migrations, client API |
| NestJS / TypeScript | `Context7` MCP | Latest NestJS decorators, modules, patterns |

## Error Handling

**Validation errors**: Use `class-validator` decorators on DTO classes. Global ValidationPipe auto-returns 422 with details.

**Not-found errors**: Throw `NotFoundException` from services. Global exception filter returns structured 404.

**Duplicate errors**: Catch Prisma `P2002` unique constraint violation and convert to `409 Conflict`.
