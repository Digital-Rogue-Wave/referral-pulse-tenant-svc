# NestJS Conventions & Rules

## Code Conventions

- Use **NestJS 11.x** with **Express** adapter
- **Prisma** for database access with PostgreSQL
- Module aggregation: `ConfigModule → CommonModule → CoreModule → FeaturesModule`
- Fail-fast configuration: app crashes at startup if env vars are missing
- `class-validator` + `class-transformer` for DTO validation
- Feature-first modules: `src/features/{entity}/` with module, controller, service, dto, repository
- Circuit breaker pattern for all external calls
- Request context via `AsyncLocalStorage` for correlation ID propagation
- Tests: Jest + supertest for API integration tests

## Package Layout

```
src/
├── main.ts
├── app.module.ts
├── config/          # Configuration management (fail-fast)
├── common/          # Cross-cutting: exceptions, filters, interceptors, middleware, pipes, context, global modules
├── database/        # Database configuration
├── domains/         # All Dtos, Responses and mapper for http and messaging
├── health/          # Health module for all the app
├── types/           # All custom types and interfaces
└── features/        # Business feature modules
    └── {entity}/    # module, controller, service, entity, repository
```

## NestJS Rules

- Use decorator-based DI (`@Injectable()`, `@Module()`, `@Controller()`)
- Module aggregation pattern: LoggingModule → CommonModule → AppModule
- Fail-fast configuration: app crashes at startup if env vars are missing — all required values live in `.env`, never as `??` defaults in code
- Use class-validator + class-transformer for DTO validation
- Use Prisma 7.x Client for database access (not TypeORM or Sequelize)
- Return structured responses via interceptors (TransformInterceptor)
- Global exception filter produces RFC 9457 ProblemDetail responses
- All external calls wrapped in circuit breaker pattern
- Request context via AsyncLocalStorage for correlation ID propagation

## Prisma 7.x Rules

- Generator: `provider = "prisma-client"` (not `prisma-client-js`), with explicit `output` path
- Datasource: **no `url`** in `schema.prisma` — connection URL goes in `prisma.config.ts`
- PrismaService: Use **composition** (not inheritance) — `new PrismaClient({ adapter })` with `@prisma/adapter-pg`
- Generated client output (e.g., `src/generated/`) must be in `.gitignore`
- Keep `prisma.config.ts` at project root — Prisma CLI reads it for migrations

## Environment File Rules

- `.env` must be populated with working defaults at scaffold time so the app boots immediately
- **Write `.env` via Bash** (not Write/Edit tools) — hooks block direct `.env` modifications
- After scaffolding, `pnpm run start:dev` → Swagger UI must be accessible with zero manual config
