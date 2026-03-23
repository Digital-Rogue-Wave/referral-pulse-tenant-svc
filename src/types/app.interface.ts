/**
 * Core application interfaces.
 * ALL interfaces should be defined here.
 */

import type { SqsQueueName, SnsTopicName, EventType, SideEffectType, SideEffectStatus } from './app.type';

// ============================================================================
// TENANT & CONTEXT INTERFACES
// ============================================================================

export interface ITenantContext {
    getTenantId(): string | undefined;

    getUserId(): string | undefined;

    getRequestId(): string | undefined;

    getCorrelationId(): string | undefined;

    getTraceId(): string | undefined;

    getSpanId(): string | undefined;

    getIdempotencyKey(): string | undefined;
}

export interface ILoggerContext {
    tenantId?: string;
    requestId?: string;
    userId?: string;
    correlationId?: string;
    traceId?: string;
    spanId?: string;

    [key: string]: unknown;
}

// ============================================================================
// HTTP & CIRCUIT BREAKER INTERFACES
// ============================================================================

/**
 * Circuit breaker configuration
 */
export interface ICircuitBreakerConfig {
    failureThreshold: number;
    halfOpenMaxCalls: number;
    monitoringPeriod: number;
    timeout: number;
    errorThresholdPercentage: number;
    resetTimeout: number;
    volumeThreshold: number;
}

/**
 * Circuit breaker state information
 */
export interface CircuitBreakerInfo {
    name: string;
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failures: number;
    successes: number;
    totalCalls: number;
    consecutiveSuccesses: number;
    windowStart: number;
    lastFailure?: Date;
    nextRetryTime?: Date;
}

export interface IHttpRequestOptions {
    timeout?: number;
    retries?: number;
    skipCircuitBreaker?: boolean;
    headers?: Record<string, string>;
    params?: Record<string, string | number | boolean>;
}

export interface IHttpResponse<T = unknown> {
    data: T;
    status: number;
    headers: Record<string, string>;
    duration: number;
}

// ============================================================================
// MESSAGING INTERFACES (SQS/SNS)
// ============================================================================

/**
 * Message envelope for all messages.
 * Includes tenant context for multi-tenancy support.
 */
export interface IMessageEnvelope<T = unknown> {
    messageId: string;
    eventType: string;
    version: string;
    timestamp: string;
    source: string;
    tenantId: string;
    correlationId: string;
    idempotencyKey?: string;
    payload: T;
    metadata: IMessageMetadata;
}

export interface IMessageMetadata {
    userId?: string;
    traceId?: string;
    spanId?: string;
    retryCount?: number;
    originalTimestamp?: string;

    [key: string]: unknown;
}

export interface IMessageHandler<T = unknown> {
    eventType: string;

    handle(message: IMessageEnvelope<T>): Promise<void>;
}

export interface IPublishOptions {
    /**
     * Delay before message becomes available (0-900 seconds)
     */
    delaySeconds?: number;

    /**
     * Message group ID for FIFO queues (required for FIFO)
     */
    messageGroupId?: string;

    /**
     * Application-level idempotency key for duplicate processing prevention
     * - Used by MessageProcessorService to check Redis
     * - Default: auto-generated from tenant context
     * - Also used as MessageDeduplicationId if not explicitly provided
     */
    idempotencyKey?: string;

    /**
     * AWS SQS/SNS deduplication ID (FIFO only)
     * - Prevents duplicate sends within 5-minute window
     * - Default: uses idempotencyKey or messageId
     * - Set explicitly only if you need different dedup behavior than processing
     *
     * Example: Retry sending after failure but prevent duplicate processing
     * ```typescript
     * {
     *   idempotencyKey: 'order-123',        // Same - dedupe processing
     *   messageDeduplicationId: 'retry-2'   // Different - allow resend
     * }
     * ```
     */
    messageDeduplicationId?: string;

    /**
     * Custom message attributes
     */
    attributes?: Record<string, string>;
}

/**
 * DLQ message wrapper.
 */
export interface IDlqMessage<T = unknown> {
    originalMessage: IMessageEnvelope<T>;
    error: string;
    failedAt: string;
    receiveCount: number;
    sourceQueue: string;
}

// ============================================================================
// STORAGE INTERFACES (S3)
// ============================================================================

export interface IS3UploadOptions {
    contentType?: string;
    metadata?: Record<string, string>;
    acl?: 'private' | 'public-read' | 'public-read-write';
    serverSideEncryption?: 'AES256' | 'aws:kms';
    cacheControl?: string;
    tagging?: string;
}

export interface IPresignedUrlOptions {
    expiresIn?: number;
    contentType?: string;
    contentDisposition?: string;
}

export interface IS3UploadResult {
    key: string;
    bucket: string;
    location: string;
    etag: string;
    versionId?: string;
}

export interface IS3ObjectMetadata {
    key: string;
    size: number;
    lastModified: Date;
    contentType?: string;
    etag: string;
    metadata?: Record<string, string>;
}

// ============================================================================
// REDIS/CACHE INTERFACES
// ============================================================================

export interface ICacheOptions {
    ttl?: number;
    prefix?: string;
    serialize?: boolean;
    tenantScoped?: boolean;
}

export interface ILockOptions {
    ttl: number;
    retryCount?: number;
    retryDelay?: number;
}

export interface ILockResult {
    acquired: boolean;
    lockId?: string;
    release: () => Promise<void>;
}

export interface ISpanAttributes {
    [key: string]: string | number | boolean | undefined;
}

// ============================================================================
// HEALTH CHECK INTERFACES
// ============================================================================

export interface IHealthCheckResult {
    status: 'healthy' | 'unhealthy' | 'degraded';
    details: Record<string, IHealthIndicatorResult>;
    timestamp: string;
}

export interface IHealthIndicatorResult {
    status: 'up' | 'down';
    message?: string;
    latency?: number;
    details?: Record<string, unknown>;
}

// ============================================================================
// PAGINATION INTERFACES
// ============================================================================

export interface IPaginationMeta {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}

export interface IPaginatedResponse<T> {
    data: T[];
    meta: IPaginationMeta;
}

// ============================================================================
// ERROR RESPONSE INTERFACES
// ============================================================================

export interface IErrorResponse {
    statusCode: number;
    errorCode: string;
    message: string;
    details?: unknown;
    timestamp: string;
    path: string;
    requestId: string;
    traceId?: string;
}

export interface IJwtPayload {
    sub: string; // User ID or client ID (for M2M)
    iss: string; // Issuer (Hydra: http://localhost:4444/)
    aud: string | string[]; // Audience
    exp: number; // Expiration
    iat: number; // Issued at
    jti?: string; // JWT ID

    // Hydra-specific fields
    client_id?: string; // OAuth2 client ID
    scp?: string[]; // Granted scopes (openid, tenant, roles, events.write, etc.)
    grant_type?: string; // 'client_credentials' for M2M, 'authorization_code' for user

    // Standard OIDC claims (user tokens)
    email?: string;
    email_verified?: boolean;

    // Hydra token extensions (custom claims from consent flow)
    ext?: {
        tenant_id?: string;
        user_id?: string;
        roles?: string[];
        [key: string]: unknown;
    };

    [key: string]: unknown; // Additional claims
}

export interface IAuthenticatedUser {
    userId: string;
    tenantId: string;
    email?: string;
    roles?: string[];
    permissions?: string[];
    scopes?: string[];
    metadata?: Record<string, unknown>;

    // M2M (client_credentials) tokens
    isServiceToken?: boolean;
    clientId?: string;
}

export interface MulterFile {
    buffer: Buffer;
    originalname: string;
}

// ============================================================================
// DOMAIN EVENT INTERFACES (EventEmitter2)
// ============================================================================

/**
 * Base interface for all domain events (EventEmitter2)
 * All domain events must extend this interface
 */
export interface IBaseDomainEvent {
    /**
     * Unique identifier for this event occurrence
     */
    readonly eventId: string;

    /**
     * Type of event (e.g., 'toto.created', 'user.updated')
     */
    readonly eventType: string;

    /**
     * ID of the aggregate/entity this event is about
     */
    readonly aggregateId: string;

    /**
     * Tenant ID for multi-tenant applications
     */
    readonly tenantId: string;

    /**
     * When this event occurred
     */
    readonly occurredAt: Date;

    /**
     * Optional user ID who triggered this event
     */
    readonly userId?: string;
}

/**
 * Toto domain events
 */
export interface ITotoCreatedEvent extends IBaseDomainEvent {
    readonly eventType: 'toto.created';
    readonly name: string;
    readonly status: string;
}

export interface ITotoUpdatedEvent extends IBaseDomainEvent {
    readonly eventType: 'toto.updated';
    readonly changes: Record<string, unknown>;
}

export interface ITotoDeletedEvent extends IBaseDomainEvent {
    readonly eventType: 'toto.deleted';
}
// ============================================================================
// SQS EVENT PAYLOAD INTERFACES
// ============================================================================

/**
 * SQS message payload for toto events
 */
export interface ITotoSqsPayload {
    totoId: string;
    name?: string;
    status?: string;
    tenantId: string;
    createdAt?: Date;
    updatedAt?: Date;
    changes?: Record<string, unknown>;
}

/**
 * SQS message payload for analytics events
 */
export interface IAnalyticsSqsPayload {
    eventId: string;
    eventType: string;
    aggregateId: string;
    tenantId: string;
    occurredAt: Date;
    payload: unknown;
}

/**
 * SQS message payload for audit trail events
 */
export interface IAuditSqsPayload {
    service: string;
    eventId: string;
    eventType: string;
    aggregateId: string;
    tenantId: string;
    userId?: string;
    occurredAt: Date;
    payload: unknown;
}

/**
 * SQS message payload for email service
 */
export interface IEmailSqsPayload {
    to: string;
    subject: string;
    body: string;
    templateId?: string;
    priority: 'high' | 'normal' | 'low';
    metadata?: {
        eventId?: string;
        aggregateId?: string;
        tenantId?: string;
        [key: string]: unknown;
    };
}

// ============================================================================
// EVENT LISTENER INTERFACES
// ============================================================================

/**
 * Base interface for event listeners
 */
export interface IEventListener {
    /**
     * Handle the event
     */
    handle(event: IBaseDomainEvent): Promise<void>;
}

/**
 * Event listener metadata
 */
export interface IEventListenerMetadata {
    /**
     * Event pattern to listen to (supports wildcards)
     * Examples: 'user.created', 'user.*', '**'
     */
    pattern: string;

    /**
     * Whether to run listener asynchronously
     */
    async: boolean;

    /**
     * Priority order (lower runs first)
     */
    priority?: number;
}

// ============================================================================
// SIDE EFFECTS / OUTBOX PATTERN INTERFACES
// ============================================================================

/**
 * Payload for SQS side effect
 * Used when sending messages to SQS queues via the outbox pattern
 */
export interface ISqsSideEffectPayload {
    [key: string]: unknown;
    queueName: SqsQueueName;
    eventType: EventType;
    message: Record<string, unknown>;
}

/**
 * Payload for SNS side effect
 * Used when publishing messages to SNS topics via the outbox pattern
 */
export interface ISnsSideEffectPayload {
    [key: string]: unknown;
    topicName: SnsTopicName;
    eventType: EventType;
    message: Record<string, unknown>;
}

/**
 * Email attachment interface
 */
export interface IEmailAttachment {
    /**
     * Filename for the attachment
     */
    filename: string;

    /**
     * Path to the file (S3 key or local path)
     */
    path: string;
}

/**
 * Payload for email side effect
 * Used when sending emails via the outbox pattern
 */
export interface IEmailSideEffectPayload {
    [key: string]: unknown;
    to: string | string[];
    subject: string;
    body: string;
    from?: string;
    cc?: string | string[];
    bcc?: string | string[];
    attachments?: IEmailAttachment[];
    templateId?: string;
    templateVars?: Record<string, unknown>;
}

/**
 * Payload for audit side effect
 * Used when creating audit log entries via the outbox pattern
 */
export interface IAuditSideEffectPayload {
    [key: string]: unknown;
    action: string;
    changes: Record<string, unknown>;
    userId?: string;
    timestamp: string;
    context?: Record<string, unknown>;
}

/**
 * Union type for all side effect payloads
 */
export type SideEffectPayload =
    | ISqsSideEffectPayload
    | ISnsSideEffectPayload
    | IEmailSideEffectPayload
    | IAuditSideEffectPayload;

/**
 * DTO for creating a side effect in the outbox pattern
 *
 * The outbox pattern ensures side effects (like sending SQS messages, HTTP calls, etc.)
 * are executed reliably and atomically with database transactions.
 *
 * Key Concepts:
 * - **aggregateType**: The domain entity type (e.g., 'toto', 'campaign', 'user')
 *   This follows Domain-Driven Design (DDD) where an "aggregate" is the root entity
 *   that owns the transaction boundary.
 *
 * - **aggregateId**: The specific entity ID that triggered this side effect
 *   Used for tracking, auditing, and finding all side effects for an entity.
 *
 * Example:
 * ```typescript
 * await sideEffectService.createSideEffect({
 *   effectType: 'sqs',
 *   aggregateType: 'toto',        // Entity type
 *   aggregateId: toto.id,          // Entity ID
 *   eventType: 'toto.created',
 *   payload: { queueName: 'toto-queue', message: {...} }
 * });
 * ```
 */
export interface ICreateSideEffectDto {
    /**
     * Type of side effect to execute (sqs, sns, email, audit)
     */
    effectType: SideEffectType;

    /**
     * Domain entity type that triggered this side effect (DDD Aggregate Root)
     * Examples: 'toto', 'campaign', 'user', 'order', 'payment'
     *
     * Purpose:
     * - Groups side effects by entity type
     * - Enables querying all side effects for a specific entity type
     * - Used in idempotency key generation
     * - Helps with debugging and audit trails
     */
    aggregateType: string;

    /**
     * Specific entity ID that triggered this side effect
     * Examples: toto.id, campaign.id, user.id
     *
     * Purpose:
     * - Links side effect to specific entity instance
     * - Enables finding all side effects for a specific entity
     * - Used in idempotency key generation
     * - Essential for audit trails and debugging
     */
    aggregateId: string;

    /**
     * Event type that triggered this side effect
     * Examples: 'toto.created', 'campaign.activated', 'user.signup'
     */
    eventType: string;

    /**
     * Side effect payload (specific to effectType)
     * - For SQS: { queueName: string, eventType: string, message: object }
     * - For SNS: { topicArn: string, eventType: string, message: object }
     * - For email: { to: string, subject: string, body: string, ... }
     * - For audit: { action: string, changes: object, userId?: string }
     */
    payload: SideEffectPayload;

    /**
     * Additional metadata (correlation IDs, user context, etc.)
     */
    metadata?: Record<string, unknown>;

    /**
     * When to execute this side effect (default: now)
     */
    scheduledAt?: Date;

    /**
     * Maximum retry attempts (default: 3)
     */
    maxRetries?: number;

    /**
     * Idempotency key for duplicate prevention
     * Auto-generated if not provided: `{aggregateType}:{aggregateId}:{eventType}:{ulid}`
     */
    idempotencyKey?: string;
}

/**
 * Side effect outbox entity interface
 */
export interface ISideEffectOutbox {
    id: string;
    tenantId: string;
    effectType: SideEffectType;
    status: SideEffectStatus;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: SideEffectPayload;
    metadata?: Record<string, unknown>;
    scheduledAt: Date;
    processedAt?: Date;
    retryCount: number;
    maxRetries: number;
    lastError?: string;
    idempotencyKey: string;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Side effects module configuration
 */
export interface ISideEffectsModuleOptions {
    /**
     * Enable background worker for processing outbox
     */
    enableWorker?: boolean;

    /**
     * Worker polling interval in milliseconds (default: 5000)
     */
    pollingInterval?: number;

    /**
     * Batch size for processing (default: 10)
     */
    batchSize?: number;

    /**
     * Enable DLQ monitoring
     */
    enableDlqMonitoring?: boolean;
}

// ============================================================================
// IDEMPOTENCY INTERFACES
// ============================================================================

/**
 * Idempotency options for operations
 */
export interface IIdempotencyOptions {
    /**
     * Time-to-live for idempotency key in seconds
     * @default 86400 (24 hours)
     */
    ttl?: number;

    /**
     * Lock timeout in seconds
     * @default 300 (5 minutes)
     */
    lockTimeout?: number;

    /**
     * Key prefix for Redis storage
     * @default 'idempotency:'
     */
    keyPrefix?: string;

    /**
     * Whether to store the response
     * @default true
     */
    storeResponse?: boolean;

    /**
     * Custom key generator
     */
    keyGenerator?: IIdempotencyKeyGenerator;
}

/**
 * Idempotency result
 */
export interface IIdempotencyResult<T = unknown> {
    /**
     * Whether this is a duplicate request
     */
    isDuplicate: boolean;

    /**
     * Original response if duplicate
     */
    originalResponse?: T;

    /**
     * When the original request was processed
     */
    processedAt?: Date;
}

/**
 * Idempotency key generator interface
 */
export interface IIdempotencyKeyGenerator {
    /**
     * Generate idempotency key from request data
     */
    generate(data: IIdempotencyKeyData): string;
}

/**
 * Idempotency key data (HTTP request-based)
 */
export interface IIdempotencyKeyData {
    /**
     * HTTP method or RPC pattern
     */
    method: string;

    /**
     * URL path or RPC service
     */
    path: string;

    /**
     * Request body or message data
     */
    body?: unknown;

    /**
     * Query parameters or metadata
     */
    query?: Record<string, unknown>;

    /**
     * User ID for user-scoped idempotency
     */
    userId?: string;

    /**
     * Tenant ID for tenant-scoped idempotency
     */
    tenantId?: string;

    /**
     * Custom idempotency key from header
     */
    customKey?: string;
}

/**
 * Idempotency decorator options
 */
export interface IIdempotencyDecoratorOptions extends IIdempotencyOptions {
    /**
     * Key prefix
     */
    prefix?: string;

    /**
     * Whether to throw error on duplicate
     */
    throwOnDuplicate?: boolean;
}

// ============================================================================
// QUEUE / BULLMQ INTERFACES
// ============================================================================

/**
 * Base job data interface
 */
export interface IBaseJobData {
    tenantId: string;
    userId?: string;
    correlationId?: string;
    traceId?: string;
    spanId?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Job options for BullMQ
 */
export interface IJobOptions {
    /**
     * Job priority (higher number = higher priority)
     */
    priority?: number;

    /**
     * Delay before job becomes available (milliseconds)
     */
    delay?: number;

    /**
     * Number of retry attempts
     */
    attempts?: number;

    /**
     * Backoff strategy for retries
     */
    backoff?: {
        type: 'exponential' | 'fixed';
        delay: number;
    };

    /**
     * Job ID for idempotency
     */
    jobId?: string;

    /**
     * Remove job on completion
     */
    removeOnComplete?: boolean | number;

    /**
     * Remove job on failure
     */
    removeOnFail?: boolean | number;

    /**
     * Repeat options for recurring jobs
     */
    repeat?: {
        pattern?: string;
        every?: number;
        limit?: number;
    };
}

/**
 * Worker configuration
 */
export interface IWorkerConfig {
    /**
     * Number of concurrent jobs
     */
    concurrency?: number;

    /**
     * Rate limiting
     */
    limiter?: {
        max: number;
        duration: number;
    };
}

/**
 * Queue configuration
 */
export interface IQueueConfig {
    /**
     * Queue name
     */
    name: string;

    /**
     * Default job options
     */
    defaultJobOptions?: IJobOptions;
}

/**
 * Job result interface
 */
export interface IJobResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    processingTime?: number;
    duration?: number;
    attemptNumber?: number;
}

/**
 * Queue metrics interface
 */
export interface IQueueMetrics {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
}

/**
 * Job progress interface
 */
export interface IJobProgress {
    percentage: number;
    message?: string;
    data?: Record<string, unknown>;
}

// ============================================================================
// BULLJOBS - SYSTEM JOB DATA INTERFACES
// ============================================================================

/**
 * System-level job data for jobs that run across all tenants.
 * Used for scheduled tasks like billing resets, daily snapshots, etc.
 */
export interface ISystemJobData extends IBaseJobData {
    tenantId: 'system';
}

/**
 * Billing job data for billing-related scheduled tasks.
 * Billing jobs run across all tenants (system-level).
 */
export type IBillingJobData = ISystemJobData;

// ============================================================================
// BULLJOBS - OUTBOX & DLQ JOB DATA INTERFACES
// ============================================================================

/**
 * Job data for processing a single side effect from the outbox
 */
export interface IOutboxJobData extends IBaseJobData {
    /**
     * The side effect outbox record ID to process
     */
    sideEffectId: string;

    /**
     * Effect type for routing (sqs, sns, email, audit)
     */
    effectType: SideEffectType;

    /**
     * Aggregate information for logging/tracing
     */
    aggregateType: string;
    aggregateId: string;

    /**
     * Event type that triggered this side effect
     */
    eventType: string;
}

/**
 * Job data for replaying a single DLQ message
 */
export interface IDlqReplayJobData extends IBaseJobData {
    /**
     * The SQS queue name (not URL)
     */
    queueName: string;

    /**
     * Original message body (JSON string)
     */
    messageBody: string;

    /**
     * Receipt handle for deleting from DLQ after successful replay
     */
    receiptHandle: string;

    /**
     * Original message ID from the envelope
     */
    originalMessageId: string;

    /**
     * Original idempotency key if present
     */
    originalIdempotencyKey?: string;
}

/**
 * Job data for batch DLQ replay (triggers individual replay jobs)
 */
export interface IDlqBatchReplayJobData extends IBaseJobData {
    /**
     * The SQS queue name to replay DLQ messages for
     */
    queueName: string;

    /**
     * Maximum number of messages to replay in this batch
     */
    maxMessages?: number;
}

/**
 * Job data for outbox cleanup (remove old completed/failed records)
 */
export interface IOutboxCleanupJobData extends IBaseJobData {
    /**
     * Delete records older than this many days
     */
    olderThanDays: number;

    /**
     * Status to clean up ('completed' | 'failed' | 'all')
     */
    status: 'completed' | 'failed' | 'all';

    /**
     * Maximum records to delete per run
     */
    limit?: number;
}

// ============================================================================
// MESSAGING DECORATOR INTERFACES
// ============================================================================

/**
 * SQS consumer decorator options
 */
export interface ISqsConsumerOptions {
    /**
     * Queue name
     */
    queueName: string;

    /**
     * Batch size for consuming messages
     */
    batchSize?: number;

    /**
     * Visibility timeout (seconds)
     */
    visibilityTimeout?: number;

    /**
     * Wait time for long polling (seconds)
     */
    waitTimeSeconds?: number;
}

/**
 * Idempotent handler decorator options
 */
export interface IIdempotentHandlerOptions {
    /**
     * TTL for idempotency key (seconds)
     */
    ttl?: number;

    /**
     * Key prefix
     */
    prefix?: string;

    /**
     * Whether to skip duplicate messages silently
     */
    skipDuplicates?: boolean;
}

export interface KetoPermission {
    namespace: string;
    relation: string;
    object?: string;
    objectParam?: string; // Route param to use as object (e.g., ':tenantId')
    allowServiceTokens?: boolean; // Allow M2M tokens to bypass Keto check
}

export interface KratosIdentityTraits {
    email: string;
    firstname?: string;
    lastname?: string;
    tenantCode?: string;
    tenantName?: string;
    company?: {
        name: string;
        country: string;
        website: string;
    };
    roles?: string[];
}

export interface KratosIdentity {
    id: string;
    schema_id: string;
    traits: KratosIdentityTraits;
    metadata_public?: Record<string, unknown>;
    metadata_admin?: Record<string, unknown>;
}

// ============================================================================
// AWS SIGNED REQUEST INTERFACE
// ============================================================================

export interface ISignedRequest {
    query?: Record<string, string | string[] | null>;
    headers: Record<string, string>;
}

// ============================================================================
// EXPRESS REQUEST EXTENSIONS
// ============================================================================

/**
 * Extended Express Request with tenant context fields
 * Used by middleware/interceptors to access tenant context from request
 */
export interface IExtendedRequest {
    tenantId?: string;
    userId?: string;
    correlationId?: string;
    requestId?: string;
    idempotencyKey?: string;
}

// ============================================================================
// TRANSACTION & EVENT EMITTER INTERFACES
// ============================================================================

/**
 * Transaction options matching Prisma's interactive transaction API
 */
export interface ITransactionOptions {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}

/**
 * Event to be emitted after transaction commit
 */
export interface ITransactionEvent {
    event: string;
    payload: unknown;
}

// ============================================================================
// TENANT-AWARE / PRISMA DELEGATE INTERFACES
// ============================================================================

/**
 * Minimal Prisma delegate interface – covers what we proxy.
 * Any Prisma model delegate (e.g. `prisma.toto`) satisfies this.
 *
 * NOTE: `any` is intentional here — these are structural bridge types that must
 * accept arbitrary Prisma-generated delegate types (e.g. TotoCreateInput, TotoWhereUniqueInput).
 * Using `Record<string, unknown>` would break compatibility with Prisma's generated types.
 */

export interface IPrismaDelegate<T> {
    create(args: { data: any; select?: any; include?: any }): Promise<T>;
    findMany(args?: {
        where?: any;
        orderBy?: any;
        skip?: number;
        take?: number;
        select?: any;
        include?: any;
    }): Promise<T[]>;
    findUnique(args: { where: any; select?: any; include?: any }): Promise<T | null>;
    findFirst(args?: { where?: any; orderBy?: any; select?: any; include?: any }): Promise<T | null>;
    findFirstOrThrow(args?: { where?: any; orderBy?: any; select?: any; include?: any }): Promise<T>;
    update(args: { where: any; data: any; select?: any; include?: any }): Promise<T>;
    delete(args: { where: any }): Promise<T>;
    count(args?: { where?: any }): Promise<number>;
}

/**
 * Options for tenant-scoped read operations.
 */
export interface ITenantReadOptions {
    /** If true, includes soft-deleted records (deletedAt IS NOT null) */
    includeSoftDeleted?: boolean;
}

/**
 * Tenant-scoped delegate returned by `TenantAwareService.forModel()`.
 *
 * Every method automatically injects the current `tenantId` from
 * AsyncLocalStorage context. Read operations also filter out
 * soft-deleted records by default.
 *
 * NOTE: `any` is intentional — mirrors IPrismaDelegate to accept Prisma-generated arg types.
 */

export interface ITenantScopedDelegate<T> {
    /** Create with auto-injected tenantId */
    create(args: { data: any; select?: any; include?: any }): Promise<T>;

    /** findMany scoped to tenant + soft-delete guard */
    findMany(
        args?: {
            where?: any;
            orderBy?: any;
            skip?: number;
            take?: number;
            select?: any;
            include?: any;
        },
        options?: ITenantReadOptions,
    ): Promise<T[]>;

    /** findUnique scoped to tenant + soft-delete guard */
    findUnique(args: { where: any; select?: any; include?: any }, options?: ITenantReadOptions): Promise<T | null>;

    /** findFirst scoped to tenant + soft-delete guard */
    findFirst(
        args?: { where?: any; orderBy?: any; select?: any; include?: any },
        options?: ITenantReadOptions,
    ): Promise<T | null>;

    /** findFirstOrThrow scoped to tenant + soft-delete guard */
    findFirstOrThrow(
        args?: { where?: any; orderBy?: any; select?: any; include?: any },
        options?: ITenantReadOptions,
    ): Promise<T>;

    /** update scoped to tenant */
    update(args: { where: any; data: any; select?: any; include?: any }): Promise<T>;

    /** Soft-delete (sets deletedAt = now), scoped to tenant */
    delete(args: { where: any }): Promise<T>;

    /** Hard-delete (real row removal), scoped to tenant */
    hardDelete(args: { where: any }): Promise<T>;

    /** count scoped to tenant + soft-delete guard */
    count(args?: { where?: any }, options?: ITenantReadOptions): Promise<number>;
}
