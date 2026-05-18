import { BaseDomainEvent } from '@domains/common/events';

/**
 * Domain event emitted when a tenant is created
 */
export class TenantCreatedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.created' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly name: string,
        public readonly slug: string,
        public readonly ownerId: string,
        public readonly trialStartedAt: Date,
        public readonly trialEndsAt: Date,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a tenant is updated
 */
export class TenantUpdatedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.updated' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly changes: Record<string, { from: unknown; to: unknown }>,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a tenant is permanently deleted
 */
export class TenantDeletedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.deleted' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly name: string,
        public readonly slug: string,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a tenant is suspended
 */
export class TenantSuspendedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.suspended' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly reason: string | undefined,
        public readonly suspendedAt: Date,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a tenant is unsuspended
 */
export class TenantUnsuspendedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.unsuspended' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly unsuspendedAt: Date,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a tenant is locked
 */
export class TenantLockedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.locked' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly reason: string | undefined,
        public readonly lockUntil: Date | undefined,
        public readonly lockedAt: Date,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a tenant is unlocked
 */
export class TenantUnlockedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.unlocked' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly unlockedBy: string,
        public readonly unlockedAt: Date,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when tenant deletion is scheduled
 */
export class TenantDeletionScheduledEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.deletion-scheduled' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly scheduledAt: Date,
        public readonly executionDate: Date,
        public readonly reason: string | undefined,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when tenant deletion is cancelled
 */
export class TenantDeletionCancelledEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.deletion-cancelled' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly cancelledAt: Date,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when tenant ownership is transferred
 */
export class TenantOwnershipTransferredEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.ownership-transferred' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly oldOwnerId: string,
        public readonly newOwnerId: string,
        public readonly transferredAt: Date,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Domain event emitted when a custom domain is verified
 */
export class TenantDomainVerifiedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.domain-verified' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly domain: string,
        public readonly verifiedAt: Date,
        public readonly userId?: string,
    ) {
        super();
    }
}

/**
 * Event type constants for convenience
 */
export const TenantEvents = {
    CREATED: 'tenant.created',
    UPDATED: 'tenant.updated',
    DELETED: 'tenant.deleted',
    SUSPENDED: 'tenant.suspended',
    UNSUSPENDED: 'tenant.unsuspended',
    LOCKED: 'tenant.locked',
    UNLOCKED: 'tenant.unlocked',
    DELETION_SCHEDULED: 'tenant.deletion-scheduled',
    DELETION_CANCELLED: 'tenant.deletion-cancelled',
    OWNERSHIP_TRANSFERRED: 'tenant.ownership-transferred',
    DOMAIN_VERIFIED: 'tenant.domain-verified',
} as const;
