import { ulid } from 'ulid';

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
 *     readonly eventType = 'user.created';
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
   * Unique identifier for this event occurrence
   */
  readonly eventId: string = ulid();

  /**
   * When this event occurred
   */
  readonly occurredAt: Date = new Date();

  /**
   * Type of event (e.g., 'user.created', 'order.placed')
   * Must be overridden by concrete event classes
   */
  abstract readonly eventType: string;

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
}