import { EntityHelperDto } from '@mod/common/dto/entity-helper.dto';
import { ApiKeyStatusEnum } from '@mod/common/enums/api-key.enum';
import { ApiProperty } from '@nestjs/swagger';

export class ApiKeyDto extends EntityHelperDto {
    @ApiProperty({
        description: 'Unique identifier for the API key',
        example: '550e8400-e29b-41d4-a716-446655440000'
    })
    id: string;

    @ApiProperty({
        description: 'Tenant ID this API key belongs to',
        example: '550e8400-e29b-41d4-a716-446655440000'
    })
    tenantId: string;

    @ApiProperty({
        description: 'Friendly name for the API key',
        example: 'Production API Key'
    })
    name: string;

    @ApiProperty({
        description: 'Prefix of the API key for identification',
        example: 'sk_live_abc'
    })
    keyPrefix: string;

    @ApiProperty({
        description: 'Current status of the API key',
        enum: ApiKeyStatusEnum,
        example: ApiKeyStatusEnum.ACTIVE
    })
    status: ApiKeyStatusEnum;

    @ApiProperty({
        description: 'Permission scopes granted to this API key',
        example: ['campaigns:read', 'campaigns:write'],
        type: [String]
    })
    scopes: string[];

    @ApiProperty({
        description: 'Last time this API key was used',
        example: '2024-12-11T10:30:00Z',
        nullable: true
    })
    lastUsedAt: Date | null;

    @ApiProperty({
        description: 'Expiration date of the API key',
        example: '2025-12-31T23:59:59Z',
        nullable: true
    })
    expiresAt: Date | null;
}
