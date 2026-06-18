import { BaseDomainEvent } from '@domains/common/events';

/**
 * Domain event emitted when a User is created
 */
export class UserCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'user.created' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly email?: string,
        public readonly source?: string,
        public readonly referralCode?: string,
        public readonly userId?: string
    ) {
        super();
    }
}

/**
 * Domain event emitted when a User is updated
 */
export class UserUpdatedEvent extends BaseDomainEvent {
    readonly eventType = 'user.updated' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly changes: Record<string, { from: unknown; to: unknown }>,
        public readonly userId?: string
    ) {
        super();
    }
}

/**
 * Domain event emitted when a User is deleted
 */
export class UserDeletedEvent extends BaseDomainEvent {
    readonly eventType = 'user.deleted' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly userId?: string
    ) {
        super();
    }
}

/**
 * Domain event emitted when a platform user is registered into a tenant
 * (Identity & Access — referralai_event_model_v2.1.md §4.12: user.registered).
 */
export class UserRegisteredEvent extends BaseDomainEvent {
    readonly eventType = 'user.registered' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly role: string,
        public readonly userId?: string
    ) {
        super();
    }
}

/**
 * Domain event emitted when a platform user's role changes
 * (Identity & Access — referralai_event_model_v2.1.md §4.12: user.role_changed).
 */
export class UserRoleChangedEvent extends BaseDomainEvent {
    readonly eventType = 'user.role_changed' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly oldRole: string,
        public readonly newRole: string,
        public readonly userId?: string
    ) {
        super();
    }
}

/**
 * Event type constants for convenience
 */
export const UserEvents = {
    CREATED: 'user.created',
    UPDATED: 'user.updated',
    DELETED: 'user.deleted',
    REGISTERED: 'user.registered',
    ROLE_CHANGED: 'user.role_changed'
} as const;
