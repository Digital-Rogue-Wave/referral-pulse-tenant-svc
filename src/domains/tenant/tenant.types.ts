/**
 * Tenant lifecycle status (DB Model v2 §3 `tenants.status`). `locked` is this service's additive value for the
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
 * Company (client account) verification status.
 * Owned by this service per referralai_system_architecture_v1.md §Company Verification;
 * transitions are driven by the workflow service's `account_verification` Temporal workflow.
 */
export enum VerificationStatus {
    UNVERIFIED = 'unverified',
    PENDING = 'pending',
    VERIFIED = 'verified',
    REJECTED = 'rejected'
}

/** What a `tenant_verifications` row verifies (DB Model v2 §3). Only `company` drives the tenant's status. */
export enum VerificationType {
    COMPANY = 'company',
    TAX = 'tax',
    PAYOUT_PROVIDER = 'payout_provider'
}

/** A verification's own state; `pending` and `in_review` both show the tenant as `pending`. */
export enum VerificationRecordStatus {
    PENDING = 'pending',
    IN_REVIEW = 'in_review',
    VERIFIED = 'verified',
    REJECTED = 'rejected'
}
