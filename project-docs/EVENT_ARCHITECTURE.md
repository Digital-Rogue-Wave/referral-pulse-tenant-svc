# Event Architecture Guide

## Overview

This service uses a **hybrid event architecture** combining:
1. **EventEmitter2** for in-process side effects (analytics, audit, metrics)
2. **SQS** for cross-service communication with DLQ monitoring
3. **Outbox Pattern** for critical operations requiring guaranteed delivery

## Event Type Separation

### 1. EventEmitter2 Events (In-Process)

**Purpose**: Handle side effects within the same service instance
**Use for**: Analytics, audit trail, metrics, non-critical notifications

**Event Types** (defined in `types/app.type.ts`):
```typescript
export type DomainEventType =
    | TotoEventType          // 'toto.created', 'toto.updated', 'toto.deleted'
    | CampaignEventType      // 'campaign.created', 'campaign.updated', ...
    | ReferralEventType      // 'referral.created', 'referral.clicked', ...
    | UserEventType          // 'user.created', 'user.updated', ...
    | EmailEventType;        // See email section below
```

**Example Usage**:
```typescript
@Transactional()
async create(dto: CreateTotoDto) {
  const saved = await this.repository.save(entity);

  // Emit domain event AFTER transaction commits
  this.txEventEmitter.emitAfterCommit(
    'toto.created',
    new TotoCreatedEvent(saved.id, saved.tenantId, saved.name, saved.status, userId)
  );

  return saved;
}
```

**Event Listeners** automatically handle:
- ✅ Analytics tracking (to analytics service via SQS)
- ✅ Audit trail (to audit service via SQS)
- ✅ Metrics recording (Prometheus)
- ✅ Cross-service notifications (via SQS)

---

### 2. SQS Events (Cross-Service)

**Purpose**: Send messages to other microservices asynchronously
**Use for**: Cross-service workflows, async processing, external service integration

**Event Types** (defined in `types/app.type.ts`):
```typescript
export type SqsEventType =
    | TotoSqsEventType       // 'toto.created', 'toto.updated', 'toto.file.uploaded'
    | CampaignSqsEventType   // 'campaign.created', 'campaign.activated', ...
    | AnalyticsSqsEventType  // 'analytics.event'
    | AuditSqsEventType      // 'audit.event'
    | EmailSqsEventType;     // 'email.send'
```

**Example Usage** (via event listeners):
```typescript
@Injectable()
export class CrossServiceListener {
  @OnEvent('toto.created', { async: true })
  async handleTotoCreated(event: TotoCreatedEvent): Promise<void> {
    // Send to SQS for other microservices
    await this.sqsProducer.send(
      'toto-updates-queue',
      event.eventType,
      { totoId: event.aggregateId, name: event.name },
      { idempotencyKey: `${event.eventType}-${event.aggregateId}` }
    );
  }
}
```

---

## Email Event Architecture

### Critical Emails (Guaranteed Delivery)

**Purpose**: Emails that MUST be delivered (transactional emails)
**Delivery Strategy**: SQS + DLQ monitoring

**Event Types**:
```typescript
export type CriticalEmailEventType =
    | 'email.critical.password-reset'
    | 'email.critical.account-verification'
    | 'email.critical.security-alert'
    | 'email.critical.receipt'
    | 'email.critical.invoice'
    | 'email.critical.welcome'
    | 'email.critical.payment-confirmation';
```

**Usage Example**:
```typescript
@Transactional()
async sendPasswordReset(userId: string, email: string) {
  // Emit critical email event
  this.txEventEmitter.emitAfterCommit(
    'email.critical.password-reset',
    new CriticalEmailEvent(
      userId,           // aggregateId
      tenantId,         // tenantId
      email,            // to
      'Reset Your Password',
      'Click here to reset...',
      'password-reset-template',
      { resetToken }    // metadata
    )
  );
}
```

**Flow**:
1. Event emitted via `txEventEmitter.emitAfterCommit()`
2. `EmailNotificationListener` catches `email.critical.*` events
3. Listener sends to **SQS queue** (`email-service-queue`)
4. Email service processes with DLQ fallback
5. ✅ **Guaranteed delivery** with retries

---

### Marketing Emails (Best Effort)

**Purpose**: Non-critical promotional emails (acceptable loss)
**Delivery Strategy**: Fire-and-forget HTTP call

**Event Types**:
```typescript
export type MarketingEmailEventType =
    | 'email.marketing.newsletter'
    | 'email.marketing.promotion'
    | 'email.marketing.product-update'
    | 'email.marketing.tips'
    | 'email.marketing.survey';
```

**Usage Example**:
```typescript
@Transactional()
async subscribeToNewsletter(userId: string, email: string) {
  // Emit marketing email event
  this.txEventEmitter.emitAfterCommit(
    'email.marketing.newsletter',
    new MarketingEmailEvent(
      userId,           // aggregateId
      tenantId,         // tenantId
      email,            // to
      'Welcome to Our Newsletter!',
      'Thanks for subscribing...',
      'https://unsubscribe.link'
    )
  );
}
```

**Flow**:
1. Event emitted via `txEventEmitter.emitAfterCommit()`
2. `EmailNotificationListener` catches `email.marketing.*` events
3. Listener makes **fire-and-forget HTTP call** to email service
4. Errors are logged but **not retried**
5. ✅ **Best effort** delivery (acceptable loss)

---

## When to Use What?

### Use Outbox Pattern (Rare - Critical Atomicity)

**ONLY when DB transaction + side effect MUST be atomic:**

```typescript
@Transactional()
async processPayment(orderId: string, amount: number) {
  const payment = await this.paymentRepo.save(...);

  // CRITICAL: Must be atomic with DB
  await this.sideEffectService.createHttpSideEffect(
    'payment', payment.id, 'payment.charged', 'POST',
    'https://stripe.com/charges',
    { amount, currency: 'USD' }
  );
}
```

**Use for**:
- ✅ Payment API calls (Stripe, PayPal)
- ✅ Financial transactions (billing, refunds)
- ✅ Critical customer webhooks with SLA

---

### Use Direct SQS + DLQ (Common - Cross-Service)

**Most microservice communication:**

```typescript
@OnEvent('user.created', { async: true })
async handleUserCreated(event: UserCreatedEvent): Promise<void> {
  await this.sqsProducer.send(
    'user-events-queue',
    event.eventType,
    { userId: event.aggregateId },
    { idempotencyKey: `user-created-${event.aggregateId}` }
  );
  // Failure goes to DLQ automatically
}
```

**Use for**:
- ✅ Cross-service messages (User→Email, Referral→Reward)
- ✅ Analytics service integration
- ✅ Audit trail service
- ✅ Critical emails (via SQS)

---

### Use EventEmitter2 (Common - Local Side Effects)

**In-process side effects:**

```typescript
@Transactional()
async create(dto: CreateDto) {
  const saved = await this.repository.save(entity);

  // Single event emission - listeners handle everything
  this.txEventEmitter.emitAfterCommit(
    'entity.created',
    new EntityCreatedEvent(...)
  );
}
```

**Use for**:
- ✅ Analytics tracking (listener sends to SQS)
- ✅ Audit trail (listener sends to SQS)
- ✅ Metrics recording (in-process)
- ✅ Non-critical emails (listener sends HTTP)

---

## Architecture Guarantees

### EventEmitter2 Events
- ✅ Events emit **ONLY after transaction commits**
- ✅ No phantom events on rollback
- ✅ Listeners run asynchronously
- ✅ Easy to add/remove listeners
- ❌ No guarantee if process crashes before listeners execute

### SQS Events (via Listeners)
- ✅ Retries with exponential backoff
- ✅ DLQ for failed messages
- ✅ Monitoring and replay capability
- ✅ Idempotency built-in
- ❌ Not atomic with DB transaction (use outbox if needed)

### Outbox Pattern
- ✅ Atomic with DB transaction
- ✅ Guaranteed delivery (survives crashes)
- ✅ Automatic retries with exponential backoff
- ✅ Audit trail
- ❌ DB overhead (extra writes)

---

## Type System

All event types are centralized in `src/types/`:

**Types** (`app.type.ts`):
- `DomainEventType` - EventEmitter2 events
- `SqsEventType` - SQS message types
- `EmailEventType` - Email event categories
- `CriticalEmailEventType` - Critical email types
- `MarketingEmailEventType` - Marketing email types
- `EmailDeliveryStrategy` - 'guaranteed' | 'best-effort'
- `EmailPriority` - 'critical' | 'high' | 'normal' | 'low'

**Interfaces** (`app.interface.ts`):
- `IBaseDomainEvent` - Base for all domain events
- `ITotoCreatedEvent` - Toto domain event interfaces
- `ICriticalEmailEvent` - Critical email interface
- `IMarketingEmailEvent` - Marketing email interface
- `ITotoSqsPayload` - SQS message payload
- `IAnalyticsSqsPayload` - Analytics SQS payload
- `IAuditSqsPayload` - Audit SQS payload
- `IEmailSqsPayload` - Email service SQS payload

---

## Example: Complete Flow

```typescript
// 1. Business Service (Clean)
@Injectable()
export class UserService {
  @Transactional()
  async signup(dto: SignupDto) {
    const user = await this.userRepo.save(...);

    // CRITICAL: SNS via outbox (guaranteed delivery)
    await this.sideEffectService.createSnsSideEffect(
      'user', user.id, 'user.created', 'user-events-topic',
      { userId: user.id, email: user.email }
    );

    // NON-CRITICAL: Emit event (listeners handle everything)
    this.txEventEmitter.emitAfterCommit(
      'user.created',
      new UserCreatedEvent(user.id, tenantId, user.email, userId)
    );
  }
}

// 2. Analytics Listener (Automatic)
@Injectable()
export class AnalyticsListener {
  @OnEvent('**', { async: true })
  async trackAllEvents(event: BaseDomainEvent): Promise<void> {
    await this.sqsProducer.send(
      'analytics-events-queue',
      'analytics.event',
      { eventId: event.eventId, eventType: event.eventType, payload: event },
      { idempotencyKey: `analytics-${event.eventId}` }
    );
  }
}

// 3. Email Listener (Critical vs Marketing)
@Injectable()
export class EmailNotificationListener {
  // Critical emails → SQS
  @OnEvent('email.critical.*', { async: true })
  async handleCriticalEmail(event: CriticalEmailEvent): Promise<void> {
    await this.sqsProducer.send(
      'email-service-queue',
      'email.send',
      { to: event.to, subject: event.subject, priority: 'high' },
      { idempotencyKey: `email-${event.eventId}` }
    );
  }

  // Marketing emails → HTTP fire-and-forget
  @OnEvent('email.marketing.*', { async: true })
  async handleMarketingEmail(event: MarketingEmailEvent): Promise<void> {
    try {
      await this.httpClient.post('email-service/send', {
        to: event.to, subject: event.subject
      });
    } catch (err) {
      this.logger.warn('Marketing email failed', err);
    }
  }
}
```

---

## Best Practices

1. **Business logic should emit ONE event** - let listeners handle side effects
2. **Use proper event types** - `CriticalEmailEventType` vs `MarketingEmailEventType`
3. **Always use `emitAfterCommit()`** - ensures events only fire after DB commit
4. **Leverage wildcard listeners** - `'**'` for analytics/audit
5. **Include idempotency keys** - prevent duplicate processing
6. **Monitor DLQs** - set up CloudWatch alarms for SQS DLQs
7. **Use outbox sparingly** - only for truly critical atomic operations

---

## Migration from Old Code

**Before** (Polluted business logic):
```typescript
await Promise.all([
  this.sideEffectService.createEmailSideEffect(...),
  this.sideEffectService.createAuditSideEffect(...),
  this.sideEffectService.createSnsSideEffect(...),
]);
```

**After** (Clean hybrid approach):
```typescript
// Critical cross-service: Keep outbox
await this.sideEffectService.createSnsSideEffect(...);

// Non-critical: Emit event
this.txEventEmitter.emitAfterCommit('entity.created', new EntityCreatedEvent(...));
```

**Event listeners automatically handle**:
- Analytics (to analytics service via SQS)
- Audit trail (to audit service via SQS)
- Metrics (Prometheus in-process)
- Non-critical emails (fire-and-forget HTTP)