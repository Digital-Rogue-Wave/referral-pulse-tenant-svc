# Idempotency Key Best Practices

## TLDR

**DON'T:**
- ❌ Use ULID/UUID for idempotency keys (always unique → no deduplication)
- ❌ Use timestamps (always different → no deduplication)
- ❌ Rely on HTTP context fallback (causes cross-operation pollution)

**DO:**
- ✅ Use business-domain keys (`order-${orderId}`)
- ✅ Make keys deterministic (same operation → same key)
- ✅ Pass keys explicitly via `IPublishOptions`

## Why ULID/UUID is Wrong for Idempotency

### The Problem

```typescript
// WRONG - Each call generates different ULID
const key1 = ulid(); // 01H3X4Y5Z6ABC...
const key2 = ulid(); // 01H3X4Y5Z7DEF... (DIFFERENT!)

await sqsProducer.send('queue', 'order.created', order, {
    idempotencyKey: ulid(), // ❌ Always unique = no deduplication!
});
```

**Result:** Network retry sends 2 messages with different keys → both processed → duplicate order!

### The Solution

```typescript
// CORRECT - Deterministic key based on business entity
const orderId = '12345';

await sqsProducer.send('queue', 'order.created', order, {
    idempotencyKey: `order-created-${orderId}`, // ✅ Same order = same key
});
```

**Result:** Network retry sends 2 messages with SAME key → second message skipped → no duplicate!

## When to Use What

| Identifier Type | Use Case | Example | Deduplication |
|----------------|----------|---------|---------------|
| **ULID** | Unique message ID | `messageId: ulid()` | ❌ None (always unique) |
| **ULID** | Correlation tracking | `correlationId: ulid()` | ❌ None (always unique) |
| **Business Key** | Idempotency | `order-${orderId}` | ✅ Yes (deterministic) |
| **Composite Key** | Multi-step workflows | `workflow-${id}-step-${n}` | ✅ Yes (per step) |
| **Payload Hash** | Duplicate data prevention | `event-${sha256(payload)}` | ✅ Yes (same data) |

## Real-World Examples

### E-Commerce Order Creation

```typescript
class OrderService {
    async createOrder(dto: CreateOrderDto): Promise<Order> {
        const orderId = ulid(); // ✅ Good for entity ID

        const order = await this.orderRepo.create({ id: orderId, ...dto });

        // Send event with business-domain key
        await this.sqsProducer.send('orders', 'order.created', {
            orderId,
            customerId: dto.customerId,
            items: dto.items,
        }, {
            idempotencyKey: `order-created-${orderId}`, // ✅ Deterministic
            messageGroupId: dto.customerId,
        });

        return order;
    }
}
```

**Why it works:**
- Same order → same `orderId` → same idempotency key
- Network retry → same key → deduplication works
- DLQ replay → same key → won't reprocess

### Payment Processing

```typescript
class PaymentService {
    async processPayment(orderId: string, amount: number): Promise<void> {
        const transactionId = ulid(); // ✅ Unique transaction ID

        await this.paymentGateway.charge({ transactionId, amount });

        // Notify other services
        await this.sqsProducer.send('payments', 'payment.completed', {
            orderId,
            transactionId,
            amount,
        }, {
            // Use transaction ID - same transaction = same key
            idempotencyKey: `payment-${transactionId}`, // ✅ Deterministic
        });
    }
}
```

### Inventory Reservation (Multi-Step Workflow)

```typescript
class InventoryService {
    async reserveItems(orderId: string, items: Item[]): Promise<void> {
        const reservationId = ulid();

        for (const [index, item] of items.entries()) {
            await this.sqsProducer.send('inventory', 'item.reserve', {
                reservationId,
                orderId,
                item,
            }, {
                // Composite key - unique per item in reservation
                idempotencyKey: `reservation-${reservationId}-item-${index}`,
            });
        }
    }
}
```

### Scheduled Notification (Cron Job)

```typescript
class NotificationService {
    @Cron('0 9 * * *') // Daily at 9 AM
    async sendDailyDigest(): Promise<void> {
        const today = this.dateService.format('YYYY-MM-DD');
        const users = await this.userRepo.findActive();

        for (const user of users) {
            await this.sqsProducer.send('notifications', 'digest.send', {
                userId: user.id,
                date: today,
            }, {
                // Date-based key - same user + same day = same key
                idempotencyKey: `digest-${user.id}-${today}`,
            });
        }
    }
}
```

**Why it works:**
- If cron runs twice (overlap), same key prevents duplicate emails
- User gets exactly one digest per day

## What We Fixed

### 1. Removed Context Fallback

**Before (WRONG):**
```typescript
// message-envelope.service.ts
idempotencyKey: idempotencyKey || this.tenantContext.getIdempotencyKey()
```

**Problems:**
- HTTP idempotency key pollutes SQS messages
- Unpredictable behavior
- Cross-service contamination

**After (CORRECT):**
```typescript
// message-envelope.service.ts
idempotencyKey: idempotencyKey
```

**Now:**
- Explicit only - no fallback
- Predictable behavior
- Clean separation of concerns

### 2. Fixed DLQ Replay Deduplication

**Before (WRONG):**
```typescript
// dlq-consumer.service.ts
MessageDeduplicationId: `replay-${dedupeKey}-${this.dateService.now()}`
```

**Problem:** Timestamp makes it unique every time → no AWS-level dedup

**After (CORRECT):**
```typescript
// dlq-consumer.service.ts
MessageDeduplicationId: `dlq-replay-${envelope.messageId}`
```

**Now:**
- Static per message
- Replaying same message twice → AWS deduplicates
- Still different from original send (bypasses 5-min window)

### 3. Added Documentation to createEnvelope

```typescript
/**
 * @param idempotencyKey - Optional idempotency key for deduplication.
 *                         Should be business-domain based (e.g., "order-${orderId}")
 *                         NOT auto-generated. If not provided, consumers will fall back
 *                         to messageId (limited deduplication).
 */
createEnvelope<T>(eventType: string, payload: T, idempotencyKey?: string)
```

## Migration Guide

### If You Were Using Context Fallback

**Before:**
```typescript
// Relied on HTTP context fallback
await this.sqsProducer.send('queue', 'event', payload);
// idempotencyKey came from HTTP request header (wrong!)
```

**After:**
```typescript
// Explicitly pass business-domain key
await this.sqsProducer.send('queue', 'event', payload, {
    idempotencyKey: `event-${entityId}`,
});
```

### If You Were Using ULID

**Before:**
```typescript
await this.sqsProducer.send('queue', 'event', payload, {
    idempotencyKey: ulid(), // ❌ Always unique
});
```

**After:**
```typescript
const entityId = payload.id; // Or any stable business identifier

await this.sqsProducer.send('queue', 'event', payload, {
    idempotencyKey: `event-${eventType}-${entityId}`,
});
```

## Deduplication Layers

Your application now has **3 layers of deduplication**:

### Layer 1: AWS SQS FIFO (5 minutes)

```typescript
MessageDeduplicationId: options?.messageDeduplicationId || envelope.idempotencyKey || envelope.messageId
```

- Prevents duplicate **sends** at AWS infrastructure level
- 5-minute window
- Falls back to `idempotencyKey` if no explicit dedup ID

### Layer 2: Application Redis (24 hours)

```typescript
// MessageProcessorService
const idempotencyKey = envelope.idempotencyKey || envelope.messageId;
await this.idempotencyService.executeOnce(idempotencyKey, handler);
```

- Prevents duplicate **processing** at application level
- 24-hour window (configurable)
- Falls back to `messageId` if no idempotency key

### Layer 3: DLQ Replay Tracking (24 hours)

```typescript
// DlqConsumerService
const replayTrackingKey = `dlq:replay:${queueName}:${appDedupeKey}`;
await this.idempotencyService.isDuplicate(replayTrackingKey);
```

- Prevents replaying same message multiple times
- 24-hour window
- Specific to DLQ replay operations

## Testing Idempotency

```typescript
describe('Order Creation Idempotency', () => {
    it('should deduplicate duplicate sends', async () => {
        const orderId = ulid();
        const key = `order-created-${orderId}`;

        // Send twice with same key
        await sqsProducer.send('orders', 'order.created', { orderId }, {
            idempotencyKey: key,
        });

        await sqsProducer.send('orders', 'order.created', { orderId }, {
            idempotencyKey: key,
        });

        // Wait for processing
        await delay(1000);

        // Should only create one order
        const orders = await orderRepo.findByOrderId(orderId);
        expect(orders).toHaveLength(1);
    });

    it('should allow different orders even with similar data', async () => {
        const data = { productId: 'prod-1', quantity: 2 };

        // Two different orders with same data
        const orderId1 = ulid();
        const orderId2 = ulid();

        await sqsProducer.send('orders', 'order.created', { orderId: orderId1, ...data }, {
            idempotencyKey: `order-created-${orderId1}`,
        });

        await sqsProducer.send('orders', 'order.created', { orderId: orderId2, ...data }, {
            idempotencyKey: `order-created-${orderId2}`,
        });

        await delay(1000);

        // Should create two orders (different IDs = different keys)
        const order1 = await orderRepo.findByOrderId(orderId1);
        const order2 = await orderRepo.findByOrderId(orderId2);

        expect(order1).toBeDefined();
        expect(order2).toBeDefined();
        expect(order1.id).not.toBe(order2.id);
    });
});
```

## Summary

**Key Takeaways:**

1. **ULID is for unique IDs** (`messageId`, `correlationId`, entity IDs)
2. **Business keys are for idempotency** (`order-${orderId}`, `payment-${txId}`)
3. **No magic fallbacks** - be explicit about idempotency keys
4. **Think deterministic** - same operation should produce same key
5. **Test deduplication** - verify your keys actually work

**Remember:** Idempotency keys are about **deduplicating operations**, not creating unique identifiers.