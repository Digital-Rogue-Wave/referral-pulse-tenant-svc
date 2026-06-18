/**
 * Core application types and type utilities.
 * ALL types should be defined here.
 */

// ============================================================================
// AUTH CONSTANTS
// ============================================================================

export const IS_PUBLIC_KEY = 'isPublic';

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Event categories (entities/aggregates)
 * Add new categories as the application grows
 */
export type EventCategory =
    | 'toto'
    | 'user'
    | 'campaign'
    | 'reward'
    | 'referral'
    | 'analytics'
    | 'notification'
    | 'system'
    | 'email'
    | 'audit'
    | 'api-key'
    | 'api_key'
    | 'tenant'
    | 'billing'
    | 'invitation'
    | 'team-member'
    | 'tenant-setting'
    | 'dns'
    | 'subscription'
    | 'trial'
    | 'usage'
    | 'payment';

/**
 * Event actions (what happened)
 * Add new actions as needed
 */
export type EventAction =
    | 'created'
    | 'updated'
    | 'deleted'
    | 'activated'
    | 'deactivated'
    | 'completed'
    | 'failed'
    | 'sent'
    | 'received'
    | 'processed'
    | 'clicked'
    | 'converted'
    | 'rewarded'
    | 'expired'
    | 'paused'
    | 'uploaded'
    | 'event'
    | 'status'
    | 'accepted'
    | 'revoked'
    | 'rejected'
    | 'resent'
    | 'reserved'
    | 'released'
    | 'domain-added'
    | 'domain-verified'
    | 'domain-removed'
    | 'suspended'
    | 'unsuspended'
    | 'locked'
    | 'unlocked'
    | 'deletion-scheduled'
    | 'deletion-cancelled'
    | 'ownership-transferred'
    | 'invitation_sent'
    | 'changed'
    | 'cancelled'
    | 'downgrade-scheduled'
    | 'upgraded'
    | 'payment-status-changed'
    | 'reminder'
    | 'restricted'
    | 'restored'
    | 'monthly_summary'
    | 'threshold_crossed'
    | 'registered'
    | 'role_changed'
    | 'verification_requested'
    | 'verification_status_changed';

/**
 * Valid base event type combining category and action
 * This is the strict format for domain events
 */
export type BaseEventType = `${EventCategory}.${EventAction}`;

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
    Test = 'test'
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
    Custom = 'custom'
}

/**
 * Job priority levels for BullMQ
 */
export enum JobPriority {
    Critical = 1,
    High = 3,
    Normal = 5,
    Low = 7,
    Lowest = 10
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

export type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E };

export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

// ============================================================================
// REQUEST CONTEXT TYPE (AsyncLocalStorage)
// ============================================================================

export type RequestContext = {
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
    isInTransaction?: boolean;
    transactionEvents?: Array<{ event: string; payload: unknown }>;
};

export type RequiredContextKeys = 'requestId' | 'tenantId' | 'userId';
export type MinimalRequestContext = Pick<RequestContext, 'requestId' | 'tenantId'>;

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
    | 'IDEMPOTENCY_CONFLICT'
    | 'PLAN_LIMIT_EXCEEDED'
    | 'TENANT_NOT_FOUND'
    | 'PAYMENT_REQUIRED'
    | 'TENANT_LOCKED'
    | 'TENANT_SUSPENDED'
    | 'INVALID_API_KEY'
    | 'FILE_NOT_FOUND'
    | 'FILE_UPLOAD_FAILED'
    | 'INVALID_FILE_URL';

// ============================================================================
// EVENT TYPES - EVENTEMITTER2 (In-Process Events)
// ============================================================================

/**
 * EventEmitter2 event types for in-process side effects.
 * These events are handled by listeners within the same service instance.
 * Use for: analytics, audit, metrics, non-critical notifications
 */

// Toto domain events
export type TotoEventType = 'toto.created' | 'toto.updated' | 'toto.deleted' | 'toto.uploaded';

// Campaign domain events
export type CampaignEventType =
    | 'campaign.created'
    | 'campaign.updated'
    | 'campaign.activated'
    | 'campaign.paused'
    | 'campaign.completed'
    | 'campaign.deleted';

// Referral domain events
export type ReferralEventType = 'referral.created' | 'referral.clicked' | 'referral.converted' | 'referral.rewarded' | 'referral.expired';

// User domain events
export type UserEventType =
    | 'user.created'
    | 'user.updated'
    | 'user.activated'
    | 'user.deactivated'
    | 'user.deleted'
    | 'user.registered'
    | 'user.role_changed';

// API Key domain events
export type ApiKeyEventType = 'api-key.created' | 'api-key.updated' | 'api-key.status' | 'api-key.deleted';

// Tenant Setting domain events
export type TenantSettingEventType = 'tenant-setting.created' | 'tenant-setting.updated' | 'tenant-setting.deleted';

// Notification domain events
export type NotificationEventType = 'notification.updated' | 'notification.sent';

// Team Member domain events
export type TeamMemberEventType = 'team-member.created' | 'team-member.updated' | 'team-member.deleted' | 'team-member.status';

// Invitation domain events
export type InvitationEventType = 'invitation.created' | 'invitation.accepted' | 'invitation.revoked' | 'invitation.rejected' | 'invitation.resent';

// DNS domain events
export type DnsEventType = 'dns.reserved' | 'dns.released' | 'dns.domain-added' | 'dns.domain-verified' | 'dns.domain-removed';

// Tenant domain events
export type TenantEventType =
    | 'tenant.created'
    | 'tenant.updated'
    | 'tenant.deleted'
    | 'tenant.suspended'
    | 'tenant.unsuspended'
    | 'tenant.locked'
    | 'tenant.unlocked'
    | 'tenant.deletion-scheduled'
    | 'tenant.deletion-cancelled'
    | 'tenant.ownership-transferred'
    | 'tenant.domain-verified'
    | 'tenant.restricted'
    | 'tenant.restored'
    | 'tenant.payment-status-changed'
    | 'tenant.verification_requested'
    | 'tenant.verification_status_changed';

// Billing domain events
export type BillingEventType =
    | 'billing.created'
    | 'billing.updated'
    | 'billing.cancelled'
    | 'billing.changed'
    | 'billing.upgraded'
    | 'billing.downgrade-scheduled';

// Subscription domain events
export type SubscriptionEventType =
    | 'subscription.created'
    | 'subscription.changed'
    | 'subscription.cancelled'
    | 'subscription.upgraded'
    | 'subscription.downgrade-scheduled';

// Trial domain events
export type TrialEventType = 'trial.reminder' | 'trial.expired';

// Usage domain events
export type UsageEventType = 'usage.threshold_crossed' | 'usage.monthly_summary';

// Payment domain events
export type PaymentEventType = 'payment.failed' | 'payment.restored';

// Email event types
export type EmailEventType = 'email.sent' | 'email.failed' | 'email.received';

// All domain events (EventEmitter2)
export type DomainEventType =
    | TotoEventType
    | CampaignEventType
    | ReferralEventType
    | UserEventType
    | ApiKeyEventType
    | TenantSettingEventType
    | NotificationEventType
    | TeamMemberEventType
    | InvitationEventType
    | DnsEventType
    | TenantEventType
    | BillingEventType
    | SubscriptionEventType
    | TrialEventType
    | UsageEventType
    | PaymentEventType
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
export type TotoSqsEventType = 'toto.created' | 'toto.updated' | 'toto.deleted' | 'toto.uploaded';

// Cross-service campaign events
export type CampaignSqsEventType = 'campaign.created' | 'campaign.updated' | 'campaign.activated' | 'campaign.paused';

// Analytics events (sent to analytics service)
export type AnalyticsSqsEventType = 'analytics.event';
export const AnalyticsSqsEvents = {
    EVENT: 'analytics.event' as AnalyticsSqsEventType
} as const;

// Audit trail events (sent to audit service)
export type AuditSqsEventType = 'audit.event';
export const AuditSqsEvents = {
    EVENT: 'audit.event' as AuditSqsEventType
} as const;

// Email service events (sent to notification-webhook service)
export type EmailSqsEventType = 'email.send';
export const EmailSqsEvents = {
    SEND: 'email.send' as EmailSqsEventType
} as const;

// API Key SQS events (sent to audit service)
export type ApiKeySqsEventType = 'api-key.created' | 'api-key.updated' | 'api-key.status' | 'api-key.deleted';

// All SQS events
export type SqsEventType =
    | TotoSqsEventType
    | CampaignSqsEventType
    | AnalyticsSqsEventType
    | AuditSqsEventType
    | EmailSqsEventType
    | ApiKeySqsEventType;

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
 * SQS Queue name constants — one FIFO queue per destination service.
 * The eventType field in the message envelope routes logic on the consumer side.
 */

// Inter-service queues (FIFO)
export const TENANT_SVC_FIFO = 'tenant-svc.fifo' as const;
export const REWARD_SVC_FIFO = 'reward-svc.fifo' as const;
export const CAMPAIGN_SVC_FIFO = 'campaign-svc.fifo' as const;
export const ANALYTICS_SVC_FIFO = 'analytics-svc.fifo' as const;
export const SEGMENTATION_SVC_FIFO = 'segmentation-svc.fifo' as const;
export const REFERRAL_WORKFLOW_SVC_FIFO = 'referral-workflow-svc.fifo' as const;
export const NOTIFICATION_WEBHOOK_SVC_FIFO = 'notification-webhook-svc.fifo' as const;
export const AI_INTELLIGENCE_SVC_FIFO = 'ai-intelligence-svc.fifo' as const;

// Dedicated queues (compliance isolation)
export const AUDIT_TRAIL_FIFO = 'audit-trail.fifo' as const;

export type SqsQueueName =
    | typeof TENANT_SVC_FIFO
    | typeof REWARD_SVC_FIFO
    | typeof CAMPAIGN_SVC_FIFO
    | typeof ANALYTICS_SVC_FIFO
    | typeof SEGMENTATION_SVC_FIFO
    | typeof REFERRAL_WORKFLOW_SVC_FIFO
    | typeof NOTIFICATION_WEBHOOK_SVC_FIFO
    | typeof AI_INTELLIGENCE_SVC_FIFO
    | typeof AUDIT_TRAIL_FIFO;

/**
 * SNS Topic name constants.
 * Format: {domain}-{purpose}-topic (e.g., 'campaign-events-topic')
 */
export const TOTO_EVENTS_TOPIC = 'toto-events-topic' as const;
export const CAMPAIGN_EVENTS_TOPIC = 'campaign-events-topic' as const;
export const REFERRAL_EVENTS_TOPIC = 'referral-events-topic' as const;
export const USER_EVENTS_TOPIC = 'user-events-topic' as const;
export const BILLING_EVENTS_TOPIC = 'billing-events-topic' as const;
export const SYSTEM_NOTIFICATIONS_TOPIC = 'system-notifications-topic' as const;

export type SnsTopicName =
    | typeof TOTO_EVENTS_TOPIC
    | typeof CAMPAIGN_EVENTS_TOPIC
    | typeof REFERRAL_EVENTS_TOPIC
    | typeof USER_EVENTS_TOPIC
    | typeof BILLING_EVENTS_TOPIC
    | typeof SYSTEM_NOTIFICATIONS_TOPIC;

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

// ============================================================================
// BULLMQ QUEUE NAMES
// ============================================================================

/**
 * BullMQ queue names for background job processing
 */
export const BILLING_USAGE_QUEUE = 'billing-usage-queue';
export const TENANT_DELETION_QUEUE = 'tenant-deletion-queue';
export const TENANT_UNLOCK_QUEUE = 'tenant-unlock-queue';
export const INVITATION_QUEUE = 'invitation-queue';

/**
 * BullMQ job names for billing jobs
 */
export const MONTHLY_USAGE_RESET_JOB = 'monthly-usage-reset';
export const DAILY_USAGE_SNAPSHOT_JOB = 'daily-usage-snapshot';
export const PAYMENT_STATUS_ESCALATION_JOB = 'payment-status-escalation';
export const TRIAL_LIFECYCLE_JOB = 'trial-lifecycle';
export const PLAN_STRIPE_SYNC_JOB = 'plan-stripe-sync';
export const INVITATION_EXPIRY_JOB = 'invitation-expiry-job';

// ============================================================================
// ERROR MESSAGES
// ============================================================================

export const NO_STRIPE_CUSTOMER_ERROR = 'No Stripe customer configured for this tenant';

/**
 * All BullMQ queue names
 */
export type BullMQQueueName = typeof BILLING_USAGE_QUEUE | typeof TENANT_DELETION_QUEUE | typeof TENANT_UNLOCK_QUEUE | typeof INVITATION_QUEUE;

// ============================================================================
// BULLMQ JOB DATA TYPES
// ============================================================================

/**
 * Billing usage job data
 */
export type BillingUsageJobData = {
    tenantId: string;
    metricName: string;
    increment: number;
    timestamp: Date;
};

/**
 * Tenant deletion job data
 */
export type TenantDeletionJobData = {
    tenantId: string;
    reason?: string;
    scheduledAt: Date;
};

/**
 * Tenant unlock job data
 */
export type TenantUnlockJobData = {
    tenantId: string;
    unlockAt: Date;
};

/**
 * Invitation job data
 */
export type InvitationJobData = {
    invitationId: string;
    tenantId: string;
    email: string;
    expiresAt: Date;
};
