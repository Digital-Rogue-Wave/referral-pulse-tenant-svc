import { ulid } from 'ulid';

import type { SnsTopicName, EventType } from '@app/types';

import { BaseDomainEvent } from './base-domain.event';

/**
 * Broadcast Event - Wraps a domain event for cross-service broadcasting via SNS
 *
 * Publishes once to an SNS topic. Subscriber SQS queues are managed via infrastructure
 * (Terraform/CDK), not in application code — adding a new consumer requires zero code changes.
 *
 * Delivery: Fire-and-forget with DLQ fallback
 *
 * Usage in service:
 * ```typescript
 * // Emit the original event for local listeners
 * this.txEventEmitter.emitAfterCommit('toto.created', totoCreatedEvent);
 *
 * // Also broadcast to other services via SNS fan-out
 * this.txEventEmitter.emitAfterCommit(
 *     'broadcast',
 *     new BroadcastEvent(totoCreatedEvent, TOTO_EVENTS_TOPIC)
 * );
 * ```
 */
export class BroadcastEvent<T extends BaseDomainEvent = BaseDomainEvent> {
    /**
     * Unique ID for this broadcast event
     */
    readonly broadcastId: string = ulid();

    /**
     * When this broadcast was created
     */
    readonly createdAt: Date = new Date();

    constructor(
        /**
         * The original domain event to broadcast
         */
        public readonly event: T,

        /**
         * SNS topic to publish to (subscribers managed via infrastructure)
         */
        public readonly topicName: SnsTopicName
    ) {}

    /**
     * Get the event type from the wrapped event
     */
    get eventType(): EventType {
        return this.event.eventType as EventType;
    }

    /**
     * Get aggregate ID from wrapped event
     */
    get aggregateId(): string {
        return this.event.aggregateId;
    }

    /**
     * Get tenant ID from wrapped event
     */
    get tenantId(): string {
        return this.event.tenantId;
    }
}
