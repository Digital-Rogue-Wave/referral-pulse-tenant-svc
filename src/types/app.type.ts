/**
 * Core application types and type utilities.
 * ALL types should be defined here.
 */

import type { ClsStore } from 'nestjs-cls';

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type MaybeType<T> = T | undefined;
export type NullableType<T> = T | null;
export type OrNeverType<T> = T | never;

export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type Dictionary<T> = Record<string, T>;

// ============================================================================
// BRANDED TYPES (Nominal Typing)
// ============================================================================

export type Brand<K, T> = K & { __brand: T };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type RequestId = Brand<string, 'RequestId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type Ulid = Brand<string, 'Ulid'>;
export type ISOTimestamp = Brand<string, 'ISOTimestamp'>;
export type JwtToken = Brand<string, 'JwtToken'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

// ============================================================================
// ENUMS
// ============================================================================

export enum Environment {
    Development = 'development',
    Staging = 'staging',
    Production = 'production',
    Test = 'test',
}

/**
 * Idempotency scope for request deduplication
 */
export enum IdempotencyScope {
    /**
     * Global scope - same key across all tenants/users
     */
    Global = 'global',

    /**
     * Tenant scope - different key per tenant
     */
    Tenant = 'tenant',

    /**
     * User scope - different key per user
     */
    User = 'user',

    /**
     * Custom scope - uses custom key from request
     */
    Custom = 'custom',
}

/**
 * Job priority levels for BullMQ
 */
export enum JobPriority {
    Critical = 1,
    High = 3,
    Normal = 5,
    Low = 7,
    Lowest = 10,
}

// ============================================================================
// ENUM-LIKE TYPES
// ============================================================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type MessageDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'dlq';
export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';
export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled';
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded';
export type IndicatorStatus = 'up' | 'down';
export type OutboxStatus = 'pending' | 'processing' | 'sent' | 'failed';
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// ============================================================================
// RESULT TYPES
// ============================================================================

export type Result<T, E = Error> =
    | { success: true; data: T }
    | { success: false; error: E };

export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

// ============================================================================
// CLS CONTEXT TYPE
// ============================================================================

export type ClsRequestContext = ClsStore & {
    requestId: string;
    tenantId: string;
    userId: string;
    correlationId?: string;
    idempotencyKey?: string;
    ip?: string;
    userAgent?: string;
    route?: string;
    method?: string;
    traceId?: string;
    spanId?: string;
    startTime?: number;
    metadata?: Record<string, unknown>;
};

export type RequiredClsKeys = 'requestId' | 'tenantId' | 'userId';
export type MinimalClsContext = Pick<ClsRequestContext, 'requestId' | 'tenantId'>;

// ============================================================================
// ERROR CODES
// ============================================================================

export type ErrorCode =
    | 'VALIDATION_ERROR'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'UNPROCESSABLE_ENTITY'
    | 'TOO_MANY_REQUESTS'
    | 'INTERNAL_ERROR'
    | 'SERVICE_UNAVAILABLE'
    | 'CIRCUIT_BREAKER_OPEN'
    | 'DUPLICATE_RESOURCE'
    | 'FOREIGN_KEY_VIOLATION'
    | 'IDEMPOTENCY_CONFLICT';

// ============================================================================
// EVENT TYPES - EVENTEMITTER2 (In-Process Events)
// ============================================================================

/**
 * EventEmitter2 event types for in-process side effects.
 * These events are handled by listeners within the same service instance.
 * Use for: analytics, audit, metrics, non-critical notifications
 */

// Toto domain events
export type TotoEventType = 'toto.created' | 'toto.updated' | 'toto.deleted';

// Campaign domain events
export type CampaignEventType =
    | 'campaign.created'
    | 'campaign.updated'
    | 'campaign.activated'
    | 'campaign.paused'
    | 'campaign.completed'
    | 'campaign.deleted';

// Referral domain events
export type ReferralEventType =
    | 'referral.created'
    | 'referral.clicked'
    | 'referral.converted'
    | 'referral.rewarded'
    | 'referral.expired';

// User domain events
export type UserEventType =
    | 'user.created'
    | 'user.updated'
    | 'user.activated'
    | 'user.deactivated'
    | 'user.deleted';

// Email event types
export type EmailEventType = CriticalEmailEventType | MarketingEmailEventType;

/**
 * Critical email events (MUST be delivered via SQS + DLQ)
 * Examples: password resets, receipts, account verification, security alerts
 */
export type CriticalEmailEventType =
    | 'email.critical.password-reset'
    | 'email.critical.account-verification'
    | 'email.critical.security-alert'
    | 'email.critical.receipt'
    | 'email.critical.invoice'
    | 'email.critical.welcome'
    | 'email.critical.payment-confirmation';

/**
 * Marketing email events (best effort, fire-and-forget HTTP)
 * Examples: newsletters, promotions, product updates, tips
 */
export type MarketingEmailEventType =
    | 'email.marketing.newsletter'
    | 'email.marketing.promotion'
    | 'email.marketing.product-update'
    | 'email.marketing.tips'
    | 'email.marketing.survey';

// All domain events (EventEmitter2)
export type DomainEventType =
    | TotoEventType
    | CampaignEventType
    | ReferralEventType
    | UserEventType
    | EmailEventType;

// ============================================================================
// EVENT TYPES - SQS (Cross-Service Async Messages)
// ============================================================================

/**
 * SQS event types for cross-service communication.
 * These are sent via AWS SQS to other microservices.
 * Use for: cross-service notifications, async processing, workflows
 */

// Cross-service toto events
export type TotoSqsEventType =
    | 'toto.created'
    | 'toto.updated'
    | 'toto.deleted'
    | 'toto.file.uploaded';

// Cross-service campaign events
export type CampaignSqsEventType =
    | 'campaign.created'
    | 'campaign.updated'
    | 'campaign.activated'
    | 'campaign.paused';

// Analytics events (sent to analytics service)
export type AnalyticsSqsEventType = 'analytics.event';

// Audit trail events (sent to audit service)
export type AuditSqsEventType = 'audit.event';

// Email service events (sent to email service)
export type EmailSqsEventType = 'email.send';

// All SQS events
export type SqsEventType =
    | TotoSqsEventType
    | CampaignSqsEventType
    | AnalyticsSqsEventType
    | AuditSqsEventType
    | EmailSqsEventType;

// ============================================================================
// EVENT DELIVERY PRIORITY
// ============================================================================

/**
 * Event delivery priority for email events
 */
export type EmailPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Email delivery strategy
 */
export type EmailDeliveryStrategy =
    | 'guaranteed' // SQS + DLQ (critical emails)
    | 'best-effort'; // Fire-and-forget HTTP (marketing emails)

// ============================================================================
// MESSAGING TYPES - QUEUE & TOPIC NAMES
// ============================================================================

/**
 * SQS Queue names for the platform.
 * Add new queues here as they are created.
 * Format: {domain}-{purpose}-queue (e.g., 'toto-processing-queue')
 */
export type SqsQueueName =
    // Toto domain queues
    | 'toto-queue'
    | 'toto-processing-queue'
    | 'toto-updates-queue'
    | 'toto-file-processing-queue'
    // Campaign domain queues
    | 'campaign-queue'
    | 'campaign-events-queue'
    // Referral domain queues
    | 'referral-queue'
    | 'referral-events-queue'
    | 'referral-conversions-queue'
    | 'referral-activity-queue'
    // Reward domain queues
    | 'reward-events-queue'
    | 'reward-activity-queue'
    // Tenant domain queues
    | 'tenant-usage-queue'
    | 'tenant-alerts-queue'
    // Cross-cutting queues
    | 'analytics-queue'
    | 'audit-queue'
    | 'audit-trail-queue'
    | 'tracking-events-queue'
    | 'email-queue'
    | 'email-service-queue'
    | 'notification-queue';

/**
 * SNS Topic names for the platform.
 * Add new topics here as they are created.
 * Format: {domain}-{purpose}-topic (e.g., 'campaign-events-topic')
 */
export type SnsTopicName =
    | 'toto-events-topic'
    | 'campaign-events-topic'
    | 'referral-events-topic'
    | 'user-events-topic'
    | 'system-notifications-topic';

/**
 * Combined event type for all messaging (SQS/SNS/EventEmitter)
 * Use this for type-safe event type parameters
 */
export type EventType = DomainEventType | SqsEventType;

// ============================================================================
// SQS MESSAGE TYPES (for @ssut/nestjs-sqs)
// ============================================================================

export type SqsMessageHandlerMeta = {
    queueName: SqsQueueName;
    batchSize?: number;
    visibilityTimeout?: number;
};

// ============================================================================
// SIDE EFFECTS / OUTBOX PATTERN TYPES
// ============================================================================

/**
 * Side effect types for outbox pattern
 * Defines the type of side effect to execute
 */
export type SideEffectType = 'sqs' | 'sns' | 'email' | 'audit';

/**
 * Side effect processing status
 */
export type SideEffectStatus = 'pending' | 'processing' | 'completed' | 'failed';
