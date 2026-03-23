# Event-Driven Side Effects Pattern

This document describes the event-driven side effect architecture for async external operations (SQS/SNS, email, audit trail, metrics, etc.).

## Architecture Overview

```
HTTP Request
    ↓
AlsAuthInterceptor (sets tenant context: tenantId, userId, correlationId, traceId)
    ↓
Controller
    ↓
Service [Prisma $transaction if needed]
    ├─ Database operations (TenantAwareService.forModel) - optional
    ├─ Cache operations (RedisService) - optional
    └─ Emit domain event: TransactionEventEmitterService.emitAfterCommit()
        ↓
[Transaction Commits (if any)]
    ↓
EventEmitter2 emits domain event
    ↓
Event Listeners (async, parallel)
    └─ Call SideEffectService for external async operations
        ↓
SideEffectService
    ├─ critical: true  → Outbox pattern (DB + BullMQ worker)
    └─ critical: false → Direct SQS/SNS with DLQ
```

**Key point:** `SideEffectService` is called from event listeners. The `critical` flag determines the delivery pattern:
- `critical: true` - Outbox pattern with guaranteed delivery via BullMQ worker
- `critical: false` - Direct SQS/SNS with DLQ fallback (faster, acceptable loss)

## Key Principles

1. **SideEffectService is called from listeners** - Listeners handle all external async communication
2. **All external async calls go through SideEffectService** - Never call `SqsProducerService` or `SnsPublisherService` directly
3. **No sync HTTP calls from event listeners** - All external communication is async via SQS/SNS
4. **Events are emitted AFTER transaction commits** - Use `TransactionEventEmitterService.emitAfterCommit()`
5. **Multi-tenancy is mandatory** - All messages must include `tenantId`, `userId`, `correlationId`, `traceId`
6. **Message validation** - All envelopes are validated with Zod before sending

## Service Layer Pattern

Services emit domain events via `TransactionEventEmitterService`. Listeners then handle all side effects.

### With Database Operations (Prisma + TenantAwareService)

```typescript
@Injectable()
export class TotoService {
    constructor(
        private readonly tenantAware: TenantAwareService,
        private readonly tenantContext: TenantContextService,
        private readonly prisma: DatabaseService,
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly redisService: RedisService,
        private readonly redisKeyBuilder: RedisKeyBuilder,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(TotoService.name);
    }

    /** Tenant-scoped Toto delegate (auto-injects tenantId) */
    private get toto() {
        return this.tenantAware.forModel(this.prisma.toto);
    }

    async create(dto: CreateTotoDto): Promise<TotoResponse> {
        // 1. DATABASE: Create entity (tenantId auto-injected by TenantAwareService)
        const saved = await this.toto.create({ data: dto });

        // 2. CACHE: Redis caching (optional)
        const cacheKey = this.redisKeyBuilder.buildTenantKey('toto', `entity:${saved.id}`);
        await this.redisService.set(cacheKey, saved, { ttl: 3600 });

        // 3. EMIT EVENT: Listeners will handle all side effects (SQS/SNS)
        this.txEventEmitter.emitAfterCommit(
            'toto.created',
            new TotoCreatedEvent(saved.id, saved.tenantId, saved.name, saved.status, this.tenantContext.getUserId())
        );

        return totoResponseMapper.toResponse(saved);
    }
}
```

### Without Database Operations

```typescript
@Injectable()
export class NotificationService {
    constructor(
        private readonly txEventEmitter: TransactionEventEmitterService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(NotificationService.name);
    }

    async sendNotification(dto: SendNotificationDto): Promise<void> {
        // Just emit event - listeners handle the actual sending
        this.txEventEmitter.emitAfterCommit(
            'email.sent',
            new EmailEvent(dto.recipientId, this.tenantContext.getTenantId(), dto.to, dto.subject, dto.body)
        );

        this.logger.log('Notification event emitted', { to: dto.to });
    }
}
```

## Event Listener Pattern

Listeners handle ALL external communication via `SideEffectService`. Both critical and non-critical side effects are managed here.

```typescript
@Injectable()
export class CampaignServiceListener {
    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly logger: AppLoggerService,
        private readonly redisKeyBuilder: RedisKeyBuilder
    ) {
        this.logger.setContext(CampaignServiceListener.name);
    }

    /**
     * NON-CRITICAL: Direct SQS with DLQ (faster, acceptable loss)
     */
    @OnEvent('toto.created', { async: true })
    async handleTotoCreated(event: TotoCreatedEvent): Promise<void> {
        try {
            await this.sideEffectService.createSqsSideEffect(
                'campaign',                // aggregateType
                event.aggregateId,         // aggregateId
                'campaign.created',        // eventType (must be in EventType union)
                'campaign-events-queue',   // queueName (must be in SqsQueueName union)
                {
                    totoId: event.aggregateId,
                    name: event.name,
                    tenantId: event.tenantId,
                    userId: event.userId
                },
                {
                    critical: false, // Direct SQS with DLQ
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(
                        `campaign-toto-created-${event.aggregateId}`
                    )
                }
            );

            this.logger.debug(`Sent toto.created to campaign service`, {
                eventId: event.eventId,
                totoId: event.aggregateId
            });
        } catch (error) {
            this.logger.error(
                `Failed to send toto.created (check DLQ)`,
                error instanceof Error ? error.stack : undefined,
                { eventId: event.eventId }
            );
        }
    }

    /**
     * CRITICAL: Outbox pattern for guaranteed delivery
     */
    @OnEvent('order.completed', { async: true })
    async handleOrderCompleted(event: OrderCompletedEvent): Promise<void> {
        try {
            await this.sideEffectService.createSqsSideEffect(
                'payment',
                event.aggregateId,
                'payment.process',
                'payment-events-queue',
                {
                    orderId: event.aggregateId,
                    amount: event.amount,
                    tenantId: event.tenantId
                },
                {
                    critical: true, // Outbox pattern - guaranteed delivery
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(
                        `payment-order-${event.aggregateId}`
                    )
                }
            );
        } catch (error) {
            this.logger.error(
                `Failed to queue payment processing`,
                error instanceof Error ? error.stack : undefined,
                { eventId: event.eventId }
            );
        }
    }
}
```

## SideEffectService Options

| Option | Description | Default |
|--------|-------------|---------|
| `critical` | Use outbox pattern (true) or direct SQS/SNS (false) | `true` |
| `idempotencyKey` | Business-domain key for deduplication | Auto-generated |
| `messageGroupId` | FIFO ordering key | `tenantId` |
| `delaySeconds` | Delay before message available (SQS) | `0` |
| `scheduledAt` | Future execution time (outbox only) | `now` |
| `maxRetries` | Max retry attempts (outbox only) | `3` |

### When to use `critical: true` (Outbox Pattern)

- Payment notifications
- Order confirmations
- Critical business workflows
- Cross-service data synchronization

### When to use `critical: false` (Direct with DLQ)

- Analytics events
- Audit trail
- Metrics/monitoring
- Non-essential notifications

## Message Envelope Validation

All messages are wrapped in an envelope with mandatory fields:

```typescript
interface IMessageEnvelope<T> {
    messageId: string;        // ULID, auto-generated
    eventType: string;        // Required
    version: string;          // Default: '1.0'
    timestamp: string;        // ISO 8601
    source: string;           // Service name
    tenantId: string;         // Required - multi-tenancy
    correlationId: string;    // Required - distributed tracing
    idempotencyKey?: string;  // Optional - deduplication
    payload: T;               // Event data
    metadata: {
        userId: string;       // Required
        traceId: string;      // Required
        spanId?: string;      // Optional
    };
}
```

Validation happens automatically via Zod before sending:

```typescript
// In MessageEnvelopeService
const envelopeSchema = z.object({
    messageId: z.string().min(1),
    eventType: z.string().min(1),
    tenantId: z.string().min(1),
    correlationId: z.string().min(1),
    metadata: z.object({
        userId: z.string().min(1),
        traceId: z.string().min(1),
        spanId: z.string().optional()
    })
    // ... other fields
});
```

## Why No Circuit Breaker for Side Effects?

Circuit breaker is **NOT recommended** for SideEffectService because:

1. **Outbox pattern already provides resilience** - BullMQ worker retries with exponential backoff
2. **DLQ handles failures** - Direct messages have DLQ fallback
3. **SQS/SNS are highly available** - Managed services with built-in redundancy
4. **Would prevent retries** - Circuit breaker would block messages during transient failures

Circuit breaker **IS appropriate** for:
- Synchronous HTTP calls (already implemented in `HttpClientService`)
- External API integrations in service layer

## File Structure

```
src/common/
├── events/
│   ├── transaction-event-emitter.service.ts   # Post-commit event emission
│   └── listeners/
│       ├── audit-trail.listener.ts            # Wildcard ** → audit-trail-queue
│       ├── campaign-service.listener.ts       # toto.* → campaign-events-queue
│       ├── email-notification.listener.ts     # email.* → email-service-queue
│       ├── metrics.listener.ts                # ** → in-process metrics
│       ├── referral-service.listener.ts       # referral.*, user.*, campaign.*
│       ├── reward-service.listener.ts         # toto.*, user.*
│       ├── tenant-service.listener.ts         # toto.* → tenant-usage-queue
│       └── tracking-service.listener.ts       # ** → tracking-events-queue
├── messaging/
│   ├── message-envelope.service.ts            # Envelope creation with validation
│   ├── sqs-producer.service.ts                # SQS sending (internal use)
│   └── sns-publisher.service.ts               # SNS publishing (internal use)
└── side-effects/
    ├── side-effect.service.ts                 # Main entry point for side effects
    ├── side-effect-outbox.entity.ts           # Outbox table entity
    └── outbox-worker.service.ts               # BullMQ worker for outbox
```

## Adding a New Listener

1. Create listener file in `src/common/events/listeners/`
2. Use `@OnEvent('pattern', { async: true })` decorator
3. Always use `SideEffectService` for external calls
4. Never make sync HTTP calls
5. Add error handling with DLQ reference in logs
6. Register listener in `EventsModule`

```typescript
@Injectable()
export class MyServiceListener {
    constructor(
        private readonly sideEffectService: SideEffectService,
        private readonly logger: AppLoggerService,
        private readonly redisKeyBuilder: RedisKeyBuilder
    ) {
        this.logger.setContext(MyServiceListener.name);
    }

    @OnEvent('my.event', { async: true })
    async handleMyEvent(event: MyEvent): Promise<void> {
        try {
            await this.sideEffectService.createSqsSideEffect(
                'my-aggregate',
                event.aggregateId,
                'my.event.type',      // Must exist in EventType
                'my-queue',           // Must exist in SqsQueueName
                { /* payload */ },
                {
                    critical: false,
                    idempotencyKey: this.redisKeyBuilder.buildIdempotencyKey(`my-event-${event.eventId}`)
                }
            );
        } catch (error) {
            this.logger.warn(`Failed to send my.event (check DLQ)`, {
                eventId: event.eventId,
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }
    }
}
```

## Type Safety

Add new event types and queue names to `src/types/app.type.ts`:

```typescript
// Event types
export type MyEventType = 'my.created' | 'my.updated' | 'my.deleted';
export type EventType = DomainEventType | SqsEventType | MyEventType;

// Queue names
export type SqsQueueName =
    | 'existing-queues'
    | 'my-queue';
```