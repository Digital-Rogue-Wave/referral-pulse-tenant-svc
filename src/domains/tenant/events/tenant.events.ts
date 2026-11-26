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
        /** Null when a platform admin creates the tenant: the Owner joins later by invitation. */
        public readonly ownerId: string | null,
        public readonly trialStartedAt: Date,
        public readonly trialEndsAt: Date,
        public readonly userId?: string,
        /** Residency and raw-data retention (API §8.3) — services holding event data apply them. */
        public readonly residency?: { dataRegion: string; retentionMonths: number }
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
 * The Owner opened a KYB session (`POST /v1/verification`). In-process only, for the audit trail: v5.2 publishes the
 * verification only as `tenant.verified`, when the status changes.
 */
export class TenantVerificationRequestedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.verification_requested' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly tenantName: string,
        public readonly userId?: string,
        public readonly verificationId?: string
    ) {
        super();
    }
}

/**
 * v5.2 Event Model §5.11 `tenant.verified`, on every `verification_status` change (Payout Model §5 gate 1):
 * `pending_review` when the KYB provider calls back, `verified` or `rejected` on the Super Admin's decision.
 * `decidedBy` is `provider:{name}` or `staff:{identity}`.
 */
export class TenantVerifiedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.verified' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly previousStatus: string,
        public readonly verificationStatus: string,
        public readonly decidedBy: string,
        public readonly decidedAt: Date,
        public readonly reason: string | null,
        /** The audit trail's actor: the same decider. */
        public readonly userId: string = decidedBy
    ) {
        super();
    }
}

// ============================================================
// Event type constants
// ============================================================

/** The Owner read the widget-token secret (US1.5.4 F2). In-process only: it exists for the audit trail. */
export class TenantWidgetSecretRevealedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.widget_secret_revealed' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly userId: string
    ) {
        super();
    }
}

/**
 * The widget-token secret was replaced (US1.5.4 F3). Published so Event Ingestion drops its cached copy at
 * once; it carries no secret, only until when the previous one is still accepted.
 */
export class TenantWidgetSecretRotatedEvent extends BaseDomainEvent {
    readonly eventType = 'tenant.widget_secret_rotated' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly kid: string,
        public readonly previousValidUntil: Date,
        public readonly userId: string
    ) {
        super();
    }
}

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
    VERIFIED: 'tenant.verified',
    WIDGET_SECRET_REVEALED: 'tenant.widget_secret_revealed',
    WIDGET_SECRET_ROTATED: 'tenant.widget_secret_rotated'
} as const;
