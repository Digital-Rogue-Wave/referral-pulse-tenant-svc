import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@app/domains/common/base.entity';

export type SideEffectType = 'sqs' | 'sns' | 'email' | 'audit';
export type SideEffectStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Outbox pattern entity for reliable side effects
 *
 * Purpose:
 * - Store side effects in the same transaction as the main operation
 * - Ensure exactly-once processing with background worker
 * - Enable rollback capability when side effects fail
 * - Provide audit trail of all side effects
 *
 * Lifecycle:
 * 1. Created with status='pending' in same transaction as main operation
 * 2. Background worker picks up pending records every 5 seconds
 * 3. Worker updates status to 'processing' before execution
 * 4. On success: status='completed', processedAt set
 * 5. On failure: retryCount++, lastError updated, status='failed' if max retries reached
 */
@Entity('side_effect_outbox')
@Index(['status', 'scheduledAt']) // For efficient worker queries
@Index(['tenantId', 'status'])
@Index(['aggregateType', 'aggregateId']) // For finding all effects of an entity
export class SideEffectOutboxEntity extends BaseEntity {
    /**
     * Type of side effect to execute
     */
    @Column({ name: 'effect_type', type: 'varchar', length: 50 })
    effectType: SideEffectType;

    /**
     * Current processing status
     */
    @Column({ type: 'varchar', length: 50, default: 'pending' })
    status: SideEffectStatus;

    /**
     * Entity type that triggered this side effect (e.g., 'toto', 'campaign')
     */
    @Column({ name: 'aggregate_type', type: 'varchar', length: 100 })
    aggregateType: string;

    /**
     * Entity ID that triggered this side effect
     */
    @Column({ name: 'aggregate_id', type: 'uuid' })
    aggregateId: string;

    /**
     * Event type (e.g., 'toto.file.uploaded', 'campaign.created')
     */
    @Column({ name: 'event_type', type: 'varchar', length: 100 })
    eventType: string;

    /**
     * Side effect payload (queue name, topic ARN, HTTP URL, etc.)
     */
    @Column({ type: 'jsonb' })
    payload: Record<string, any>;

    /**
     * Optional metadata (headers, correlation IDs, etc.)
     */
    @Column({ type: 'jsonb', nullable: true })
    metadata?: Record<string, any>;

    /**
     * When to execute this side effect (allows delayed execution)
     */
    @Column({ name: 'scheduled_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    scheduledAt: Date;

    /**
     * Number of retry attempts
     */
    @Column({ name: 'retry_count', type: 'int', default: 0 })
    retryCount: number;

    /**
     * Maximum retry attempts before marking as failed
     */
    @Column({ name: 'max_retries', type: 'int', default: 3 })
    maxRetries: number;

    /**
     * Last error message (for debugging)
     */
    @Column({ name: 'last_error', type: 'text', nullable: true })
    lastError?: string;

    /**
     * When the side effect was successfully processed
     */
    @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
    processedAt?: Date;

    /**
     * Idempotency key to prevent duplicate processing
     */
    @Column({ name: 'idempotency_key', type: 'varchar', length: 255, nullable: true })
    idempotencyKey?: string;

    // Note: createdAt and updatedAt are inherited from BaseEntity
}