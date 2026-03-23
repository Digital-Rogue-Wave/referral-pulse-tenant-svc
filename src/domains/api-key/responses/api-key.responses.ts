import { ApiProperty } from '@nestjs/swagger';

/**
 * API Key Response class for API responses
 */
export class ApiKeyResponse {
    @ApiProperty({
        description: 'Unique identifier for the API key',
        example: '',
    })
    id!: string;

    @ApiProperty({
        description: 'Tenant ID this API key belongs to',
        example: '',
    })
    tenantId!: string;

    @ApiProperty({
        description: 'Friendly name for the API key',
        example: 'Production API Key',
    })
    name!: string;

    @ApiProperty({
        description: 'Prefix of the API key for identification',
        example: '',
    })
    keyPrefix!: string;

    @ApiProperty({
        description: 'Current status of the API key',
        example: 'active',
    })
    status!: string;

    @ApiProperty({
        description: 'Permission scopes granted to this API key',
        example: ['campaigns:read', 'campaigns:write'],
        type: [String],
    })
    scopes!: string[];

    @ApiProperty({
        description: 'User who created this API key',
        example: '',
    })
    createdBy!: string;

    @ApiProperty({
        description: 'Last time this API key was used',
        example: '2024-12-11T10:30:00Z',
        nullable: true,
    })
    lastUsedAt!: Date | null;

    @ApiProperty({
        description: 'Expiration date of the API key',
        example: '2025-12-31T23:59:59Z',
    })
    expiresAt!: Date;

    @ApiProperty({
        description: 'When the API key was created',
        example: '2024-12-11T10:30:00Z',
    })
    createdAt!: Date;

    @ApiProperty({
        description: 'When the API key was last updated',
        example: '2024-12-11T10:30:00Z',
    })
    updatedAt!: Date;
}

/**
 * API Key with raw key (returned only on creation)
 */
export class ApiKeyWithRawKeyResponse extends ApiKeyResponse {
    @ApiProperty({
        description: 'The raw API key (only shown once on creation)',
        example: '',
    })
    rawKey!: string;
}
