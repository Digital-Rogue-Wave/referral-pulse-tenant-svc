import { BaseDomainEvent } from '@domains/common/events';

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
 * Domain event emitted when a platform user authenticates
 * (Identity & Access — referralai_event_model_v2.1.md §4.12: user.logged_in). Login itself happens at
 * Ory; this is emitted from the Ory after-login webhook. Wire payload: { user_id, auth_method }.
 */
export class UserLoggedInEvent extends BaseDomainEvent {
    readonly eventType = 'user.logged_in' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly authMethod: string,
        public readonly userId?: string
    ) {
        super();
    }
}

/**
 * Event type constants for convenience
 */
export const UserEvents = {
    REGISTERED: 'user.registered',
    ROLE_CHANGED: 'user.role_changed',
    LOGGED_IN: 'user.logged_in'
} as const;
