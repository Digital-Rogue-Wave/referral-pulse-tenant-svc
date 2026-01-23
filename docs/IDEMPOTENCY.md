# Idempotency Guide

## Overview

This template provides built-in idempotency support to prevent duplicate processing of requests. Idempotency ensures that performing the same operation multiple times has the same effect as performing it once.

## Why Idempotency Matters

### HTTP Requests
- **Network retries**: Client retries when response fails to arrive
- **User errors**: Double-clicking submit buttons
- **Mobile apps**: Auto-retries on connection issues
- **Load balancers**: Automatic retries on timeouts

### SQS Messages
- **Visibility timeout**: Message redelivered if processing takes too long
- **Failed deletions**: Consumer crashes before deleting message
- **DLQ replays**: Admin manually replays failed messages
- **Network glitches**: Duplicate deliveries despite FIFO guarantees

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Idempotency System                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  HTTP Layer                      SQS Layer                   │
│  ┌──────────────────┐           ┌──────────────────┐        │
│  │ @Idempotent()    │           │ MessageProcessor │        │
│  │    Decorator     │           │    Service       │        │
│  └────────┬─────────┘           └────────┬─────────┘        │
│           │                               │                  │
│           ▼                               ▼                  │
│  ┌──────────────────┐           ┌──────────────────┐        │
│  │  Idempotency     │           │  Built-in        │        │
│  │  Interceptor     │           │  Idempotency     │        │
│  └────────┬─────────┘           └────────┬─────────┘        │
│           │                               │                  │
│           └───────────┬───────────────────┘                  │
│                       ▼                                      │
│           ┌──────────────────────┐                          │
│           │ IdempotencyService   │                          │
│           │  (Redis-backed)      │                          │
│           └──────────────────────┘                          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## HTTP Idempotency

### Basic Usage

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { Idempotent, IdempotencyScope } from '@app/common/idempotency';

@Controller('api/v1/orders')
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) {}

    @Post()
    @Idempotent({
        scope: IdempotencyScope.Tenant,
        ttl: 3600, // 1 hour
        storeResponse: true,
    })
    async createOrder(@Body() dto: CreateOrderDto): Promise<OrderResponse> {
        return this.ordersService.create(dto);
    }
}
```

### Client Usage

```bash
# First request
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-abc-123" \
  -H "x-tenant-id: tenant-456" \
  -d '{"productId": "prod-1", "quantity": 2}'

# Response: 201 Created
# { "id": "order-789", "status": "created", ... }

# Duplicate request (e.g., network retry)
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-abc-123" \
  -H "x-tenant-id: tenant-456" \
  -d '{"productId": "prod-1", "quantity": 2}'

# Response: 200 OK (cached response, no new order created!)
# { "id": "order-789", "status": "created", ... }
# Header: X-Idempotency-Replayed: true
```

### Decorator Options

```typescript
export interface IdempotencyDecoratorOptions {
    /**
     * Scope of idempotency
     * - Global: Same key across all tenants/users
     * - Tenant: Different key per tenant
     * - User: Different key per user
     * - Custom: Uses both tenant and user
     */
    scope?: IdempotencyScope;

    /**
     * HTTP header name for idempotency key
     * @default 'Idempotency-Key'
     */
    headerName?: string;

    /**
     * Whether idempotency key is required
     * If true, rejects requests without key
     * @default false
     */
    required?: boolean;

    /**
     * Time-to-live for cached response (seconds)
     * @default 86400 (24 hours)
     */
    ttl?: number;

    /**
     * Whether to store and return cached response
     * @default true
     */
    storeResponse?: boolean;
}
```

### Scoping Examples

#### Global Scope
Same idempotency key applies across all tenants and users:

```typescript
@Post('system/maintenance')
@Idempotent({
    scope: IdempotencyScope.Global,
    ttl: 300, // 5 minutes
})
async triggerMaintenance() { ... }
```

Redis key: `order-abc-123`

#### Tenant Scope (Recommended)
Different key per tenant - most common use case:

```typescript
@Post('orders')
@Idempotent({
    scope: IdempotencyScope.Tenant,
    ttl: 3600,
})
async createOrder(@Body() dto: CreateOrderDto) { ... }
```

Redis key: `tenant:tenant-456:order-abc-123`

#### User Scope
Different key per user - for user-specific operations:

```typescript
@Post('profile/avatar')
@Idempotent({
    scope: IdempotencyScope.User,
    ttl: 1800,
})
async uploadAvatar(@UploadedFile() file: File) { ... }
```

Redis key: `user:user-789:avatar-upload-xyz`

#### Custom Scope
Includes both tenant and user in key:

```typescript
@Post('settings')
@Idempotent({
    scope: IdempotencyScope.Custom,
    ttl: 3600,
})
async updateSettings(@Body() dto: SettingsDto) { ... }
```

Redis key: `tenant:tenant-456:user:user-789:settings-update-xyz`

### Required Idempotency Key

Force clients to provide idempotency key (good for critical operations):

```typescript
@Post('payments')
@Idempotent({
    scope: IdempotencyScope.User,
    ttl: 7200, // 2 hours
    required: true, // ← Rejects requests without key
})
async createPayment(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.charge(dto);
}
```

```bash
# Without key - rejected
curl -X POST /api/v1/payments -d '{"amount": 100}'
# Response: 400 Bad Request
# { "message": "Idempotency-Key header is required for this endpoint" }

# With key - accepted
curl -X POST /api/v1/payments \
  -H "Idempotency-Key: payment-xyz-789" \
  -d '{"amount": 100}'
# Response: 201 Created
```

### Custom Header Name

```typescript
@Post('webhooks/stripe')
@Idempotent({
    scope: IdempotencyScope.Global,
    headerName: 'Stripe-Idempotency-Key', // Custom header
    ttl: 3600,
})
async handleStripeWebhook(@Body() payload: any) { ... }
```

```bash
curl -X POST /api/v1/webhooks/stripe \
  -H "Stripe-Idempotency-Key: evt_123xyz"
```

## SQS Idempotency

SQS message processing includes **automatic built-in idempotency** via `MessageProcessorService`.

### Example Consumer

```typescript
import { Injectable } from '@nestjs/common';
import { Message } from '@aws-sdk/client-sqs';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import { MessageProcessorService } from '@app/common/messaging';

@Injectable()
export class OrdersConsumer {
    constructor(
        private readonly messageProcessor: MessageProcessorService,
        private readonly ordersService: OrdersService,
    ) {}

    @SqsMessageHandler('orders-queue', false)
    async handleOrderCreated(message: Message) {
        // MessageProcessorService automatically handles idempotency
        await this.messageProcessor.process<OrderCreatedPayload>(
            message,
            async (envelope) => {
                // This handler only executes once per unique message
                await this.ordersService.processOrder(envelope.payload);
            },
            { queueName: 'orders-queue' }
        );
    }
}
```

### How SQS Idempotency Works

1. **Envelope parsing**: Extracts `messageId` and `idempotencyKey` from message
2. **Idempotency check**: Uses `IdempotencyService.executeOnce()`
3. **Deduplication**: Skips processing if message already handled
4. **Metrics**: Records whether message was duplicate or new

```typescript
// Inside MessageProcessorService.process()
const idempotencyKey = envelope.idempotencyKey || envelope.messageId;

const { isDuplicate } = await this.idempotencyService.executeOnce(
    idempotencyKey,
    async () => {
        await handler(envelope); // Your business logic
        return true;
    },
);

if (isDuplicate) {
    this.logger.log(`Duplicate message skipped: ${envelope.messageId}`);
}
```

### DLQ Replay Idempotency

DLQ replay service includes built-in deduplication to prevent replaying messages multiple times:

```typescript
// From DlqConsumerService.reprocessAll()
const replayTrackingKey = `dlq:replay:${queueName}:${dedupeKey}`;

// Check if already replayed in last 24 hours
const alreadyReplayed = await this.idempotencyService.isDuplicate(replayTrackingKey);

if (alreadyReplayed) {
    this.logger.warn('Message already replayed recently, skipping');
    skipped++;
    continue;
}

// Mark as replayed (24 hour TTL)
await this.idempotencyService.markProcessed(replayTrackingKey, { replayed: true }, { ttl: 86400 });
```

## Manual Idempotency

For custom use cases, use `IdempotencyService` directly:

```typescript
import { Injectable } from '@nestjs/common';
import { IdempotencyService } from '@app/common/idempotency';

@Injectable()
export class CustomService {
    constructor(private readonly idempotency: IdempotencyService) {}

    async processImportantOperation(userId: string, data: any) {
        const key = `operation:${userId}:${data.id}`;

        const { result, isDuplicate } = await this.idempotency.executeOnce(
            key,
            async () => {
                // This code only runs once per unique key
                return await this.performOperation(data);
            },
            { ttl: 3600 }
        );

        if (isDuplicate) {
            console.log('Returning cached result from previous execution');
        }

        return result;
    }
}
```

### Manual API

```typescript
// Check if duplicate (quick check, no locking)
const isDuplicate = await this.idempotency.isDuplicate('my-key');

// Check and get original response (if duplicate)
const { isDuplicate, originalResponse } = await this.idempotency.check('my-key');

// Mark as processed (store response)
await this.idempotency.markProcessed('my-key', responseData, { ttl: 3600 });

// Acquire lock (for race condition protection)
const locked = await this.idempotency.lock('my-key');

// Release lock
await this.idempotency.unlock('my-key');

// Delete idempotency key (force re-execution)
await this.idempotency.delete('my-key');
```

## Best Practices

### 1. Use Idempotency for All State-Changing Operations

```typescript
// ✅ Good - Idempotent
@Post('orders')
@Idempotent({ scope: IdempotencyScope.Tenant, ttl: 3600 })
async createOrder() { ... }

@Put('orders/:id')
@Idempotent({ scope: IdempotencyScope.Tenant, ttl: 1800 })
async updateOrder() { ... }

@Post('payments')
@Idempotent({ scope: IdempotencyScope.User, ttl: 7200, required: true })
async createPayment() { ... }

// ❌ Bad - No idempotency on state-changing operation
@Post('orders')
async createOrder() { ... } // Can create duplicates!
```

### 2. Don't Use Idempotency for Read Operations

GET requests are naturally idempotent, no need for decorator:

```typescript
// ❌ Bad - Unnecessary
@Get('orders/:id')
@Idempotent({ ... })
async getOrder() { ... }

// ✅ Good - No decorator needed
@Get('orders/:id')
async getOrder() { ... }
```

### 3. Choose Appropriate TTL

```typescript
// Short-lived operations (5-30 minutes)
@Post('notifications')
@Idempotent({ ttl: 300 }) // 5 minutes

// Standard operations (30 minutes - 2 hours)
@Post('orders')
@Idempotent({ ttl: 3600 }) // 1 hour

// Critical financial operations (2-24 hours)
@Post('payments')
@Idempotent({ ttl: 86400 }) // 24 hours
```

### 4. Use Required Keys for Critical Operations

```typescript
// ✅ Good - Payment requires idempotency key
@Post('payments')
@Idempotent({
    scope: IdempotencyScope.User,
    ttl: 7200,
    required: true, // Force client to provide key
})
async createPayment() { ... }

// ❌ Bad - Payment without required key
@Post('payments')
@Idempotent({ scope: IdempotencyScope.User })
async createPayment() { ... }
```

### 5. Client-Side Key Generation

Clients should generate deterministic, unique keys:

```typescript
// ✅ Good - UUID or timestamp-based
const idempotencyKey = `order-create-${uuidv4()}`;
// or
const idempotencyKey = `user-${userId}-order-${Date.now()}`;

// ❌ Bad - Random or non-unique
const idempotencyKey = Math.random().toString();
```

### 6. Key Naming Conventions

Use descriptive, hierarchical keys:

```typescript
// ✅ Good
"order-create-abc123"
"payment-charge-xyz789"
"user-123-avatar-upload-456"

// ❌ Bad
"abc123"
"xyz"
"operation"
```

## Troubleshooting

### Issue: Idempotency not working

**Check:**
1. Is `IdempotencyModule` imported in `AppModule`?
2. Is the HTTP request including the `Idempotency-Key` header?
3. Is Redis running and accessible?
4. Check logs for `IdempotencyInterceptor` messages

### Issue: Getting cached responses unexpectedly

**Cause**: Same idempotency key used for different operations

**Solution**: Use unique keys per operation type:
```typescript
// ✅ Good
const createKey = `order-create-${orderId}`;
const updateKey = `order-update-${orderId}-${timestamp}`;

// ❌ Bad
const key = `order-${orderId}`; // Same key for create and update!
```

### Issue: Idempotency keys not expiring

**Check**: Verify TTL is set correctly (in seconds, not milliseconds)

```typescript
// ✅ Good
@Idempotent({ ttl: 3600 }) // 1 hour in seconds

// ❌ Bad
@Idempotent({ ttl: 3600000 }) // Accidentally set to 1000 hours!
```

## Redis Storage

Idempotency data is stored in Redis with this structure:

```
Key: idempotency:tenant:tenant-123:order-abc-123
Value: {
  "response": { "id": "order-789", "status": "created", ... },
  "processedAt": "2024-01-15T10:30:00Z"
}
TTL: 3600 seconds
```

Lock keys:

```
Key: idempotency:lock:tenant:tenant-123:order-abc-123
Value: "1"
TTL: 300 seconds (5 minutes)
```

## Testing Idempotency

```typescript
describe('OrdersController', () => {
    it('should prevent duplicate order creation', async () => {
        const dto = { productId: 'prod-1', quantity: 2 };
        const idempotencyKey = 'test-order-123';

        // First request
        const result1 = await request(app.getHttpServer())
            .post('/api/v1/orders')
            .set('Idempotency-Key', idempotencyKey)
            .set('x-tenant-id', 'tenant-test')
            .send(dto)
            .expect(201);

        // Duplicate request
        const result2 = await request(app.getHttpServer())
            .post('/api/v1/orders')
            .set('Idempotency-Key', idempotencyKey)
            .set('x-tenant-id', 'tenant-test')
            .send(dto)
            .expect(200);

        // Should return same response
        expect(result1.body.id).toBe(result2.body.id);

        // Should have replay header
        expect(result2.headers['x-idempotency-replayed']).toBe('true');
    });
});
```

## Summary

| Layer | Implementation | Activation | Key Source |
|-------|---------------|-----------|------------|
| **HTTP** | `@Idempotent()` decorator + `IdempotencyInterceptor` | Opt-in per endpoint | `Idempotency-Key` header |
| **SQS** | `MessageProcessorService.process()` | Automatic | `envelope.idempotencyKey` or `messageId` |
| **Manual** | `IdempotencyService.executeOnce()` | Manual in code | Custom key |

All layers use the same underlying `IdempotencyService` backed by Redis for consistent behavior across the application.