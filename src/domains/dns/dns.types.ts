/**
 * DNS domain types
 * Defines types for subdomain and custom domain management
 */

// DomainVerificationStatus is defined in @domains/tenant/tenant.types (canonical source)

// ============================================================================
// PROVISIONING STATUS
// ============================================================================

export const ProvisioningStatus = {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    FAILED: 'failed',
} as const;

export type ProvisioningStatusType = (typeof ProvisioningStatus)[keyof typeof ProvisioningStatus];

// ============================================================================
// RESERVED SUBDOMAIN PROPS
// ============================================================================

export type ReservedSubdomainProps = {
    slug: string;
    expiresAt: Date;
    originalTenantId: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
};

// ============================================================================
// SUBDOMAIN VALIDATION RESULT
// ============================================================================

export type SubdomainValidationResult = {
    valid: boolean;
    available?: boolean;
    message?: string;
};

// ============================================================================
// DOMAIN VERIFICATION RESULT
// ============================================================================

export type DomainVerificationResult = {
    verified: boolean;
    domain: string;
    message?: string;
};

// ============================================================================
// EVENT PAYLOADS
// ============================================================================

export type SubdomainReservedPayload = {
    slug: string;
    tenantId: string;
    expiresAt: Date;
    reservedAt: Date;
};

export type SubdomainReleasedPayload = {
    slug: string;
    tenantId: string;
    releasedAt: Date;
};

export type CustomDomainAddedPayload = {
    tenantId: string;
    domain: string;
    verificationToken: string;
    addedAt: Date;
};

export type CustomDomainVerifiedPayload = {
    tenantId: string;
    domain: string;
    verifiedAt: Date;
};

export type CustomDomainRemovedPayload = {
    tenantId: string;
    domain: string;
    removedAt: Date;
};
