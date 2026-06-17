import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BaseDomainEvent } from '@domains/common/events';

// ============================================================
// Props (shape of the Prisma model)
// ============================================================

export interface ReservedSubdomainProps {
    slug: string;
    expiresAt: Date;
    originalTenantId: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
}

// ============================================================
// Value objects
// ============================================================

export interface SubdomainValidationResult {
    valid: boolean;
    available?: boolean;
    message?: string;
}

export interface DomainVerificationResult {
    verified: boolean;
    domain: string;
    message: string;
}

// ============================================================
// Provisioning
// ============================================================

export const ProvisioningStatus = {
    PENDING: 'PENDING',
    IN_PROGRESS: 'IN_PROGRESS',
    ACTIVE: 'ACTIVE',
    FAILED: 'FAILED'
} as const;

export type ProvisioningStatusType = (typeof ProvisioningStatus)[keyof typeof ProvisioningStatus];

// ============================================================
// Domain Events
// ============================================================

export class SubdomainReservedEvent extends BaseDomainEvent {
    readonly eventType = 'dns.reserved' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            slug: string;
            tenantId: string;
            expiresAt: Date;
            reservedAt: Date;
        },
        public readonly userId?: string
    ) {
        super();
    }
}

export class SubdomainReleasedEvent extends BaseDomainEvent {
    readonly eventType = 'dns.released' as const;

    constructor(
        public readonly aggregateId: string,
        public readonly tenantId: string,
        public readonly payload: {
            slug: string;
            tenantId: string;
            releasedAt: Date;
        },
        public readonly userId?: string
    ) {
        super();
    }
}

export const DnsEvents = {
    RESERVED: 'dns.reserved',
    RELEASED: 'dns.released'
} as const;

// ============================================================
// Response DTOs
// ============================================================

export class SubdomainAvailabilityResponseDto {
    @ApiProperty()
    valid!: boolean;

    @ApiPropertyOptional()
    available?: boolean;

    @ApiPropertyOptional()
    message?: string;
}
