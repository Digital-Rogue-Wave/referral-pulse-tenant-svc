import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// SubdomainAvailabilityResponse is defined in @domains/tenant/responses (canonical source)

/**
 * Response for subdomain validation
 */
export class SubdomainValidationResponse {
    @ApiProperty({ description: 'Whether the subdomain format is valid' })
    valid!: boolean;

    @ApiPropertyOptional({ description: 'Whether the subdomain is available' })
    available?: boolean;

    @ApiPropertyOptional({ description: 'Validation or error message' })
    message?: string;
}

/**
 * Response for domain verification status
 */
export class DomainVerificationResponse {
    @ApiProperty({ description: 'Whether the domain is verified' })
    verified!: boolean;

    @ApiProperty({ description: 'The domain that was checked' })
    domain!: string;

    @ApiPropertyOptional({ description: 'Verification status message' })
    message?: string;
}

/**
 * Response for domain provisioning status
 */
export class DomainProvisioningStatusResponse {
    @ApiProperty({ description: 'The domain being provisioned' })
    domain!: string;

    @ApiProperty({
        description: 'Current provisioning status',
        enum: ['pending', 'in_progress', 'completed', 'failed'],
    })
    status!: string;

    @ApiPropertyOptional({ description: 'Status message or details' })
    message?: string;
}

/**
 * Response for reserved subdomain
 */
export class ReservedSubdomainResponse {
    @ApiProperty({ description: 'The reserved subdomain slug' })
    slug!: string;

    @ApiProperty({ description: 'When the reservation expires' })
    expiresAt!: Date;

    @ApiPropertyOptional({ description: 'Tenant ID that reserved the subdomain' })
    originalTenantId?: string;

    @ApiProperty({ description: 'When the reservation was created' })
    createdAt!: Date;
}
