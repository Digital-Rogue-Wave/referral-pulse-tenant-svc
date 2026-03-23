/**
 * Tenant domain types
 * Defines types for tenant management
 */

// ============================================================================
// TENANT STATUS
// ============================================================================

export const TenantStatus = {
    ACTIVE: 'active',
    SUSPENDED: 'suspended',
    LOCKED: 'locked',
    DELETION_SCHEDULED: 'deletion_scheduled',
    DELETED: 'deleted',
} as const;

export type TenantStatusType = (typeof TenantStatus)[keyof typeof TenantStatus];

// ============================================================================
// PAYMENT STATUS
// ============================================================================

export const PaymentStatus = {
    ACTIVE: 'active',
    TRIAL: 'trial',
    PAST_DUE: 'past_due',
    GRACE_PERIOD: 'grace_period',
    SUSPENDED: 'suspended',
    CANCELLED: 'cancelled',
} as const;

export type PaymentStatusType = (typeof PaymentStatus)[keyof typeof PaymentStatus];

// ============================================================================
// DOMAIN VERIFICATION STATUS
// ============================================================================

export const DomainVerificationStatus = {
    UNVERIFIED: 'unverified',
    PENDING: 'pending',
    VERIFIED: 'verified',
    FAILED: 'failed',
} as const;

export type DomainVerificationStatusType = (typeof DomainVerificationStatus)[keyof typeof DomainVerificationStatus];

// ============================================================================
// TENANT PROPS
// ============================================================================

export type TenantProps = {
    id: string;
    name: string;
    slug: string;
    imageId: string | null;
    status: string;
    paymentStatus: string;
    paymentStatusChangedAt: Date | null;
    trialStartedAt: Date | null;
    trialEndsAt: Date | null;
    suspendedAt: Date | null;
    lockedAt: Date | null;
    lockUntil: Date | null;
    lockReason: string | null;
    deletionScheduledAt: Date | null;
    deletionReason: string | null;
    customDomain: string | null;
    domainVerificationStatus: string;
    domainVerificationToken: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
};

// ============================================================================
// TENANT PROFILE STATS
// ============================================================================

export type TenantProfileStats = {
    memberCount: number;
    pendingInvitationCount: number;
    activeApiKeyCount: number;
};

export type TenantProfileProps = TenantProps & TenantProfileStats;

// ============================================================================
// CREATE TENANT INPUT
// ============================================================================

export type CreateTenantInput = {
    name: string;
    slug?: string;
    ownerId: string;
    imageId?: string;
};

// ============================================================================
// UPDATE TENANT INPUT
// ============================================================================

export type UpdateTenantInput = {
    name?: string;
    slug?: string;
    customDomain?: string;
};
