import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Base tenant response
 */
export class TenantResponse {
    @ApiProperty({ description: 'Unique identifier' })
    id!: string;

    @ApiProperty({ description: 'Tenant name' })
    name!: string;

    @ApiProperty({ description: 'URL-friendly slug' })
    slug!: string;

    @ApiPropertyOptional({ description: 'Image ID' })
    imageId?: string;

    @ApiProperty({ description: 'Tenant status' })
    status!: string;

    @ApiProperty({ description: 'Payment status' })
    paymentStatus!: string;

    @ApiPropertyOptional({ description: 'Trial started at' })
    trialStartedAt?: Date;

    @ApiPropertyOptional({ description: 'Trial ends at' })
    trialEndsAt?: Date;

    @ApiPropertyOptional({ description: 'Custom domain' })
    customDomain?: string;

    @ApiProperty({ description: 'Domain verification status' })
    domainVerificationStatus!: string;

    @ApiProperty({ description: 'Created timestamp' })
    createdAt!: Date;

    @ApiProperty({ description: 'Updated timestamp' })
    updatedAt!: Date;
}

/**
 * Tenant profile response with statistics
 */
export class TenantProfileResponse extends TenantResponse {
    @ApiProperty({ description: 'Number of team members' })
    memberCount!: number;

    @ApiProperty({ description: 'Number of pending invitations' })
    pendingInvitationCount!: number;

    @ApiProperty({ description: 'Number of active API keys' })
    activeApiKeyCount!: number;
}

/**
 * Domain status response
 */
export class DomainStatusResponse {
    @ApiPropertyOptional({ description: 'Custom domain' })
    customDomain?: string;

    @ApiProperty({ description: 'Domain verification status' })
    domainVerificationStatus!: string;

    @ApiPropertyOptional({ description: 'Verification token for DNS TXT record' })
    domainVerificationToken?: string;
}

/**
 * Subdomain availability response
 */
export class SubdomainAvailabilityResponse {
    @ApiProperty({ description: 'Whether the subdomain is available' })
    available!: boolean;
}

/**
 * Deletion scheduled response
 */
export class DeletionScheduledResponse {
    @ApiProperty({ description: 'When deletion was scheduled' })
    scheduledAt!: Date;

    @ApiProperty({ description: 'When deletion will be executed' })
    executionDate!: Date;
}
