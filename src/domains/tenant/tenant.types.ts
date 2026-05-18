/**
 * Tenant status enum.
 * Guards import from this sub-path: @domains/tenant/tenant.types
 */
export enum TenantStatus {
    ACTIVE = 'active',
    SUSPENDED = 'suspended',
    LOCKED = 'locked',
    DELETED = 'deleted',
}
