import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvitationStatus, InvitationRole } from '../invitation.types';

/**
 * Invitation API response
 */
export class InvitationResponse {
    @ApiProperty({
        description: 'Invitation ID',
        example: 'clx1234567890',
    })
    id!: string;

    @ApiProperty({
        description: 'Tenant ID',
        example: '01HXK5V3B2R7KZDPBMQ8C4N9EF',
    })
    tenantId!: string;

    @ApiProperty({
        description: 'Invited user email',
        example: 'user@example.com',
    })
    email!: string;

    @ApiProperty({
        description: 'Role assigned to the invitee',
        example: 'MEMBER',
        enum: Object.values(InvitationRole),
    })
    role!: string;

    @ApiProperty({
        description: 'Invitation status',
        example: 'PENDING',
        enum: Object.values(InvitationStatus),
    })
    status!: string;

    @ApiProperty({
        description: 'Invitation expiration date',
        example: '2024-12-31T23:59:59.000Z',
    })
    expiresAt!: Date;

    @ApiProperty({
        description: 'Creation timestamp',
        example: '2024-01-15T10:30:00.000Z',
    })
    createdAt!: Date;

    @ApiProperty({
        description: 'Last update timestamp',
        example: '2024-01-15T10:30:00.000Z',
    })
    updatedAt!: Date;
}

/**
 * Invitation response with token (returned only on create/resend)
 */
export class InvitationWithTokenResponse extends InvitationResponse {
    @ApiProperty({
        description: 'Invitation token (only returned on creation)',
        example: 'abc123def456...',
    })
    token!: string;
}

/**
 * Invitation validation response (for public endpoint)
 */
export class InvitationValidationResponse {
    @ApiProperty({
        description: 'Whether the invitation is valid',
        example: true,
    })
    valid!: boolean;

    @ApiPropertyOptional({
        description: 'Invited email address',
        example: 'user@example.com',
    })
    email?: string;

    @ApiPropertyOptional({
        description: 'Role to be assigned',
        example: 'MEMBER',
    })
    role?: string;

    @ApiPropertyOptional({
        description: 'Tenant ID',
        example: '01HXK5V3B2R7KZDPBMQ8C4N9EF',
    })
    tenantId?: string;

    @ApiPropertyOptional({
        description: 'Error message if invalid',
        example: 'Invitation expired',
    })
    message?: string;
}
