/**
 * Tenant status enum.
 * Guards import from this sub-path: @domains/tenant/tenant.types
 */
export enum TenantStatus {
    ACTIVE = 'active',
    SUSPENDED = 'suspended',
    LOCKED = 'locked',
    DELETED = 'deleted'
}

/**
 * Company (client account) verification status.
 * Owned by this service per referralai_system_architecture_v1.md §Company Verification;
 * transitions are driven by the workflow service's `account_verification` Temporal workflow.
 */
export enum VerificationStatus {
    UNVERIFIED = 'unverified',
    PENDING_REVIEW = 'pending_review',
    VERIFIED = 'verified',
    REJECTED = 'rejected'
}
