import { ulid } from 'ulid';

import type { EventAction, EventCategory, BaseEventType } from '@app/types';

/**
 * Base class for all domain events
 *
 * Domain events represent something that happened in the domain that domain experts care about.
 * They are immutable and always in past tense (e.g., UserCreated, OrderPlaced, PaymentProcessed).
 *
 * Properties:
 * - eventId: Unique identifier for this event occurrence
 * - eventType: The type of event (e.g., 'user.created', 'order.placed')
 * - aggregateId: ID of the entity this event is about
 * - tenantId: Tenant context for multi-tenant applications
 * - occurredAt: When this event occurred
 *
 * Usage:
 *   export class UserCreatedEvent extends BaseDomainEvent {
 *     readonly eventType = BaseDomainEvent.buildEventType('user', 'created');
 *
 *     constructor(
 *       public readonly aggregateId: string,
 *       public readonly tenantId: string,
 *       public readonly email: string,
 *     ) {
 *       super();
 *     }
 *   }
 */
export abstract class BaseDomainEvent {
    /**
     * Constructs a valid event type from category and action
     * @param category - The entity/aggregate category
     * @param action - The action that occurred
     * @returns A formatted event type string like 'user.created'
     */
    static buildEventType<C extends EventCategory, A extends EventAction>(category: C, action: A): `${C}.${A}` {
        return `${category}.${action}`;
    }
    /**
     * Unique identifier for this event occurrence
     */
    readonly eventId: string = ulid();

    /**
     * When this event occurred
     */
    readonly occurredAt: Date = new Date();

    /**
     * Type of event (e.g., 'user.created', 'order.placed')
     * Must be overridden by concrete event classes using buildEventType()
     */
    abstract readonly eventType: BaseEventType;

    /**
     * ID of the aggregate/entity this event is about
     * Must be provided by concrete event classes
     */
    abstract readonly aggregateId: string;

    /**
     * Tenant ID for multi-tenant applications
     * Must be provided by concrete event classes
     */
    abstract readonly tenantId: string;

    /**
     * Optional user ID who triggered this event
     * Useful for audit trails and user-specific event tracking
     */
    readonly userId?: string;

    /**
     * Get the event category (first part of eventType)
     * e.g., 'user.created' -> 'user'
     * @throws Error if eventType format is invalid
     */
    getEventCategory(): string {
        const category = this.eventType.split('.')[0];
        if (!category) {
            throw new Error(`Invalid eventType format: ${this.eventType}. Expected 'category.action' format.`);
        }
        return category;
    }

    /**
     * Get the event action (second part of eventType)
     * e.g., 'user.created' -> 'created'
     * @throws Error if eventType format is invalid
     */
    getEventAction(): string {
        const action = this.eventType.split('.')[1];
        if (!action) {
            throw new Error(`Invalid eventType format: ${this.eventType}. Expected 'category.action' format.`);
        }
        return action;
    }
}
