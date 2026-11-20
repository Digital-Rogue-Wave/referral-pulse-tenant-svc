/**
 * Tenant lifecycle status (DB Model §3 `tenants.status`). `locked` is this service's additive value for the
 * self-service lock; `closed` is terminal (the tenant was deleted and its PII purged).
 * Payment access tiers live in `payment_status`, not here.
 */
export enum TenantStatus {
    ACTIVE = 'active',
    SUSPENDED = 'suspended',
    LOCKED = 'locked',
    CLOSED = 'closed'
}

/**
 * Company verification status (v5.2 DB Model §3 `tenants.verification_status`): `unverified` until the KYB provider
 * calls back, `pending_review` until a Super Admin decides, then `verified` or `rejected`.
 */
export enum VerificationStatus {
    UNVERIFIED = 'unverified',
    PENDING_REVIEW = 'pending_review',
    VERIFIED = 'verified',
    REJECTED = 'rejected'
}

/** What a `tenant_verifications` row verifies (DB Model §3). Only `company` drives the tenant's status. */
export enum VerificationType {
    COMPANY = 'company',
    TAX = 'tax',
    PAYOUT_PROVIDER = 'payout_provider'
}

/** A verification's own state (v5.2 DB Model §3 `tenant_verifications.status`): the tenant's values once started. */
export enum VerificationRecordStatus {
    PENDING_REVIEW = 'pending_review',
    VERIFIED = 'verified',
    REJECTED = 'rejected'
}
