import { ApiProperty } from '@nestjs/swagger';

/**
 * Team Member Response class for API responses
 */
export class TeamMemberResponse {
    @ApiProperty({
        description: 'Unique identifier for the team member',
        example: '01HXK5V3B2R7KZDPBMQ8C4N9EF',
    })
    id!: string;

    @ApiProperty({
        description: 'User ID of the team member',
        example: '01HXK5V3B2R7KZDPBMQ8C4N9EF',
    })
    userId!: string;

    @ApiProperty({
        description: 'Tenant ID',
        example: '01HXK5V3B2R7KZDPBMQ8C4N9EF',
    })
    tenantId!: string;

    @ApiProperty({
        description: 'Role of the team member',
        example: 'MEMBER',
        enum: ['OWNER', 'ADMIN', 'MEMBER'],
    })
    role!: string;

    @ApiProperty({
        description: 'Status of the team member',
        example: 'active',
        enum: ['active', 'suspended', 'invited'],
    })
    status!: string;

    @ApiProperty({
        description: 'When the team member was created',
        example: '2024-12-11T10:30:00Z',
    })
    createdAt!: Date;

    @ApiProperty({
        description: 'When the team member was last updated',
        example: '2024-12-11T10:30:00Z',
    })
    updatedAt!: Date;
}
