# CLAUDE.md - [SERVICE_NAME] Service

> Replace `[SERVICE_NAME]` with actual service name (campaign, reward, analytics, etc.)

## Project Overview

NestJS microservice for a multi-tenant referral marketing SaaS platform.

**Stack:** NestJS 10+ | TypeORM | PostgreSQL (RDS) | Redis (ElastiCache) | SQS/SNS (FIFO) | S3 | OpenTelemetry → Grafana Cloud

---

## Package Manager: pnpm ONLY

```bash
# ⚠️ NEVER use npm or yarn - enforced via preinstall hook
pnpm install              # Install dependencies
pnpm add <package>        # Add dependency
pnpm add -D <package>     # Add dev dependency
pnpm remove <package>     # Remove dependency
pnpm update --latest      # Update all packages
pnpm dedupe               # Remove duplicate packages
```

**Enforced in package.json:**
```json
{
  "packageManager": "pnpm@8.15.0",
  "engines": { "node": ">=20.0.0", "pnpm": ">=8.0.0" },
  "scripts": { "preinstall": "npx only-allow pnpm" }
}
```

---

## Quick Commands

```bash
# Development
pnpm start:dev            # Dev with hot reload (SWC)
pnpm start:debug          # Debug mode
pnpm build                # Production build
pnpm start:prod           # Run production build

# Code Quality
pnpm lint                 # Fix lint issues
pnpm lint:check           # Check only (CI)
pnpm format               # Prettier format

# Testing
pnpm test                 # Unit tests
pnpm test:watch           # Watch mode
pnpm test:cov             # Coverage report
pnpm test:e2e             # Integration tests

# Database
pnpm migration:generate -- -n MigrationName
pnpm migration:run
pnpm migration:revert

# Maintenance
pnpm clean                # Remove dist, node_modules, coverage
pnpm clean:install        # Clean + fresh install
```

---

## Path Aliases

Configured in `tsconfig.json` and `jest` config:

```typescript
import { Something } from '@app/common/something';     // src/*
import { Campaign } from '@domains/campaign';          // src/domains/*
import { RedisService } from '@common/redis';          // src/common/*
import { AppConfig } from '@config/app.config';        // src/config/*
```

| Alias | Path |
|-------|------|
| `@app/*` | `src/*` |
| `@domains/*` | `src/domains/*` |
| `@common/*` | `src/common/*` |
| `@config/*` | `src/config/*` |

---

## Build: SWC Compiler

Using SWC for ~20x faster builds than tsc:

```json
// nest-cli.json
{
  "compilerOptions": {
    "builder": "swc",
    "typeCheck": true
  }
}
```

---

## Workspace Structure (Monorepo)

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/**'      # Microservices
  - 'packages/**'  # Shared libraries
  - '!**/test/**'  # Exclude test dirs
```

```
referral-platform/
├── apps/
│   ├── campaign-service/
│   ├── reward-service/
│   └── analytics-service/
├── packages/
│   ├── common/           # Shared utilities
│   ├── messaging/        # SQS/SNS shared
│   └── types/            # Shared TypeScript types
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── package.json          # Root package.json
```

**Workspace Commands:**
```bash
pnpm -F campaign-service start:dev    # Run specific app
pnpm -F @referral/common build        # Build specific package
pnpm -r build                         # Build all packages
pnpm -r test                          # Test all packages
```

---

## Environment Configuration

```bash
# Loads .env.{NODE_ENV} automatically
NODE_ENV=development pnpm start:dev   # → .env.development
NODE_ENV=staging pnpm start:prod      # → .env.staging
NODE_ENV=production pnpm start:prod   # → .env.production
```

**Files:**
- `.env.development` - Local with LocalStack
- `.env.test` - Test environment
- `.env.staging` - AWS staging
- `.env.production` - AWS production
- `.env.example` - Template (not loaded)

**AWS Credentials:**
- **Local/Test:** Use access keys in `.env.development`
- **Staging/Production:** Leave empty - uses IAM roles (IRSA/EC2)

---

## Docker (pnpm)

```dockerfile
# Build stage
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app

# Install dependencies
COPY pnpm-lock.yaml package.json ./
RUN pnpm fetch --prod
RUN pnpm install --offline --prod

# Build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build

# Production stage
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

EXPOSE 8080
CMD ["node", "dist/main.js"]
```

**docker-compose.yaml (local dev):**
```yaml
services:
  app:
    build: .
    environment:
      - NODE_ENV=development
    volumes:
      - .:/app
      - /app/node_modules
    depends_on:
      - postgres
      - redis
      - localstack

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: referral
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  localstack:
    image: localstack/localstack:latest
    environment:
      - SERVICES=sqs,sns,s3
      - DEFAULT_REGION=eu-central-1
    ports:
      - "4566:4566"
```

---

## Critical Rules

### 1. NO `any` - Ever
```typescript
// ✅ Always explicit types
async function process(dto: CreateDto): Promise<ResponseDto> { }
// ❌ Forbidden
async function process(dto: any): Promise<any> { }
```

### 2. ULID for All IDs
```typescript
import { ulid } from 'ulid';
const id = ulid();  // ✅ Never uuid() or Math.random()
```

### 3. Every Operation is Tenant-Scoped
```typescript
// ✅ TenantAwareRepository auto-filters by tenantId
const items = await this.repository.find({ where: { status: 'active' } });
```

### 4. Idempotency Required
- HTTP mutations: `@Idempotent()` decorator
- SQS handlers: `MessageProcessorService.process()`

### 5. Events After Commit Only
```typescript
this.txEventEmitter.emitAfterCommit('entity.created', event);  // ✅
```

---

## File Structure

```
src/
├── common/
│   ├── events/            # BaseDomainEvent, TransactionEventEmitter
│   ├── helper/            # DateService, JsonService, MapperUtil
│   ├── http/              # HttpClientService, circuit breaker
│   ├── idempotency/       # @Idempotent, IdempotencyService
│   ├── logging/           # AppLoggerService (pino → Loki)
│   ├── messaging/         # SQS/SNS, MessageProcessor, DLQ
│   ├── monitoring/        # MetricsService, TracingService
│   ├── redis/             # RedisService, RedisKeyBuilder
│   ├── storage/           # S3Service, S3KeyBuilder
│   ├── side-effects/      # Outbox pattern
│   └── tenant/            # ClsTenantContext, TenantAwareRepository
├── config/                # Configuration modules
├── database/              # TypeORM config, migrations
├── domains/
│   └── [toto]/
│       ├── dto/
│       ├── responses/
│       ├── mappers/
│       └── events/
├── toto/              # Feature module
│    └──[toto]/
│       ├── toto.entity.ts
│       ├── toto.service.ts
│       ├── toto.module.ts
│       ├── toto.consumer.ts
│       ├── toto.consumer.ts
│       ├── toto.paginate-config.ts
│       └── toto.controller.ts
├── types/              # Custom types and interfaces
│    └──[types]/
│       ├── app.interface.ts # Centalize all interfaces in the app
│       ├── app.type.ts      # Centralize all types in the app
│       └── toto.controller.ts
└── main.ts
```

---

## Key Services Reference

| Service | Import | Purpose |
|---------|--------|---------|
| `ClsTenantContextService` | `@common/tenant` | Tenant/user context |
| `TenantAwareRepository<T>` | `@common/tenant` | Auto-scoped DB queries |
| `RedisService` | `@common/redis` | Cache, locks |
| `RedisKeyBuilder` | `@common/redis` | Tenant-scoped keys |
| `SqsProducerService` | `@common/messaging` | Send SQS messages |
| `SnsPublisherService` | `@common/messaging` | Publish SNS events |
| `MessageProcessorService` | `@common/messaging` | SQS with idempotency |
| `DlqConsumerService` | `@common/messaging` | DLQ monitoring/replay |
| `SideEffectService` | `@common/side-effects` | Outbox pattern |
| `TransactionEventEmitterService` | `@common/events` | Post-commit events |
| `AppLoggerService` | `@common/logging` | Structured logging |
| `DateService` | `@common/helper` | Date ops (moment-tz) |
| `JsonService` | `@common/helper` | Fast JSON (simdjson) |
| `BaseResponseMapper` | `@common/helper` | Entity→DTO mapping |

---

## Service Pattern

```typescript
@Injectable()
export class ExampleService {
    constructor(
        @InjectTenantAwareRepository(ExampleEntity)
        private readonly repository: TenantAwareRepository<ExampleEntity>,
        private readonly tenantContext: ClsTenantContextService,
        private readonly redisService: RedisService,
        private readonly redisKeyBuilder: RedisKeyBuilder,
        private readonly sideEffectService: SideEffectService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(ExampleService.name);
    }

    @Transactional()
    async create(dto: CreateDto): Promise<ResponseDto> {
        const tenantId = this.tenantContext.getTenantId();

        const entity = this.repository.create({ ...dto, tenantId });
        const saved = await this.repository.save(entity);

        // Cache
        const key = this.redisKeyBuilder.buildTenantKey('example', `entity:${saved.id}`);
        await this.redisService.set(key, saved, { ttl: 3600 });

        // CRITICAL → Outbox
        await this.sideEffectService.createSqsSideEffect(
            'example', saved.id, 'example.created', 'example-queue',
            { id: saved.id, name: saved.name, tenantId },
        );

        // NON-CRITICAL → Event after commit
        this.txEventEmitter.emitAfterCommit('example.created', new ExampleCreatedEvent(saved));

        return exampleMapper.toResponse(saved);
    }
}
```

---

## Consumer Pattern

```typescript
@Injectable()
export class ExampleConsumer {
    constructor(
        private readonly messageProcessor: MessageProcessorService,
        private readonly logger: AppLoggerService,
    ) {
        this.logger.setContext(ExampleConsumer.name);
    }

    @SqsMessageHandler('example-queue', false)
    async handle(message: Message): Promise<void> {
        await this.messageProcessor.process<Payload>(
            message,
            async (envelope) => {
                // Tenant context + idempotency handled automatically
            },
            { queueName: 'example-queue' },
        );
    }
}
```

---

## Mapper Pattern

```typescript
export class ExampleMapper extends BaseResponseMapper<ExampleEntity, ExampleResponse> {
    constructor() { super(ExampleResponse); }
}
export const exampleMapper = new ExampleMapper();

// Usage
exampleMapper.toResponse(entity)
exampleMapper.toResponseArray(entities)
exampleMapper.toListResponse(entity, ['id', 'name'])
```

---

## Redis Keys (Always Use Builder)

```typescript
this.redisKeyBuilder.buildTenantKey('cache', `entity:${id}`)  // → "app:tenant_123:cache:entity_abc"
this.redisKeyBuilder.buildLockKey('import:csv')               // → "app:tenant_123:lock:import_csv"
this.redisKeyBuilder.buildGlobalKey('config', 'flags')        // → "app:config:flags"
```

---

## Messaging (FIFO)

```typescript
// SQS with idempotency
await this.sqsProducer.send('queue-name', 'event.type', payload, {
    idempotencyKey: `create-order-${orderId}`,  // Business-domain key!
    messageGroupId: tenantId,                    // FIFO ordering
});

// DLQ replay
const result = await this.dlqConsumer.reprocessAll('queue-name');
```

**Queue naming:** `example-queue.fifo` → DLQ: `example-queue-dlq.fifo`

---

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@ssut/nestjs-sqs` | SQS integration |
| `ioredis` | Redis client |
| `typeorm` | Database ORM |
| `typeorm-transactional` | Declarative transactions |
| `nestjs-cls` | Request context (CLS) |
| `nestjs-paginate` | Pagination |
| `simdjson` | Fast JSON parsing |
| `moment-timezone` | Date handling |
| `ulid` | ID generation |
| `opossum` | Circuit breaker |
| `pino` / `pino-loki` | Logging |
| `@opentelemetry/*` | Tracing & metrics |
| `zod` | Runtime validation |

---

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `example.service.ts` |
| Classes | PascalCase | `ExampleService` |
| Interfaces | I prefix | `IExampleService` |
| DTOs | suffix Dto | `CreateExampleDto` |
| Events | suffix Event | `ExampleCreatedEvent` |
| Entities | suffix Entity | `ExampleEntity` |

---

## Checklist for New Features

- [ ] Types explicit (no `any`)
- [ ] Tenant-scoped (TenantAwareRepository)
- [ ] `@Idempotent()` on mutations
- [ ] `@Transactional()` where needed
- [ ] Events via `txEventEmitter.emitAfterCommit()`
- [ ] Critical ops via `sideEffectService`
- [ ] Mapper extends `BaseResponseMapper`
- [ ] Redis keys via `RedisKeyBuilder`
- [ ] Structured logging
- [ ] Tests written
