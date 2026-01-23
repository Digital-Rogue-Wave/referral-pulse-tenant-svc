import { BaseDomainEvent } from '@app/common/events/base-domain.event';

/**
 * Domain event emitted when a Toto is created
 *
 * Usage:
 *   this.txEventEmitter.emitAfterCommit(
 *     'toto.created',
 *     new TotoCreatedEvent(saved.id, saved.tenantId, saved.name, saved.status, userId)
 *   );
 */
export class TotoCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'toto.created' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly name: string,
        public readonly status: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a Toto is updated
 *
 * Usage:
 *   this.txEventEmitter.emitAfterCommit(
 *     'toto.updated',
 *     new TotoUpdatedEvent(updated.id, updated.tenantId, changes, userId)
 *   );
 */
export class TotoUpdatedEvent extends BaseDomainEvent {
    readonly eventType = 'toto.updated' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly changes: Record<string, any>,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a Toto is deleted
 *
 * Usage:
 *   this.txEventEmitter.emitAfterCommit(
 *     'toto.deleted',
 *     new TotoDeletedEvent(id, tenantId, userId)
 *   );
 */
export class TotoDeletedEvent extends BaseDomainEvent {
    readonly eventType = 'toto.deleted' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event type constants for convenience
 */
export const TotoEvents = {
    CREATED: 'toto.created',
    UPDATED: 'toto.updated',
    DELETED: 'toto.deleted',
} as const;