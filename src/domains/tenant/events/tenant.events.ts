import { BaseDomainEvent } from '@domains/common/events';

// ============================================================
// Tenant Domain Events
// ============================================================

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
        public readonly userId?: string
    ) {
        super();
    }
}

export class TenantUpdatedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.updated' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly changes: Record<string, { from: unknown; to: unknown }>,
        public readonly userId?: string
    ) {
        super();
    }
}

export class TenantDeletedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.deleted' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly name: string,
        public readonly slug: string,
        public readonly userId?: string
    ) {
        super();
    }
}

export class TenantSuspendedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.suspended' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly reason: string,
        public readonly suspendedAt: Date,
        public readonly userId?: string
    ) {
        super();
    }
}

export class TenantUnsuspendedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.unsuspended' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly unsuspendedAt: Date,
        public readonly userId?: string
    ) {
        super();
    }
}

export class TenantLockedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.locked' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly reason: string,
        public readonly lockedAt: Date,
        public readonly lockUntil?: Date,
        public readonly userId?: string
    ) {
        super();
    }
}

export class TenantUnlockedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.unlocked' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly unlockedBy: string,
        public readonly unlockedAt: Date,
        public readonly userId?: string
    ) {
        super();
    }
}

export class TenantDeletionScheduledEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.deletion-scheduled' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly scheduledAt: Date,
        public readonly executionDate: Date,
        public readonly reason: string,
        public readonly userId?: string
    ) {
        super();
    }
}

export class TenantDeletionCancelledEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.deletion-cancelled' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly cancelledAt: Date,
        public readonly userId?: string
    ) {
        super();
    }
}

export class TenantOwnershipTransferredEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.ownership-transferred' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly oldOwnerId: string,
        public readonly newOwnerId: string,
        public readonly transferredAt: Date,
        public readonly userId?: string
    ) {
        super();
    }
}

export class TenantDomainVerifiedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.domain-verified' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly domain: string,
        public readonly verifiedAt: Date,
        public readonly userId?: string
    ) {
        super();
    }
}

/**
 * Emitted when company verification is requested (at signup). Consumed by the workflow
 * service to start the `account_verification` Temporal workflow. snake_case wire contract.
 */
export class TenantVerificationRequestedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.verification_requested' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly tenantName: string,
        public readonly userId?: string
    ) {
        super();
    }
}

/**
 * Emitted when verification_status changes (e.g. the workflow service's decision is applied).
 */
export class TenantVerificationStatusChangedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.verification_status_changed' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousStatus: string,
        public readonly newStatus: string,
        public readonly reason?: string,
        public readonly userId?: string
    ) {
        super();
    }
}

// ============================================================
// Event type constants
// ============================================================

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
    VERIFICATION_REQUESTED: 'tenant.verification_requested',
    VERIFICATION_STATUS_CHANGED: 'tenant.verification_status_changed'
} as const;
