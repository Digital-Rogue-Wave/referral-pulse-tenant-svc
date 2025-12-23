import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ToggleFeatureFlagDto {
    @ApiProperty({
        description: 'The key of the feature flag',
        example: 'beta-feature'
    })
    @IsString()
    @IsNotEmpty()
    key: string;

    @ApiProperty({
        description: 'The ID of the tenant to toggle the feature for',
        example: 'tenant-123'
    })
    @IsString()
    @IsNotEmpty()
    tenantId: string;

    @ApiProperty({
        description: 'Whether the feature should be enabled or disabled',
        example: true
    })
    @IsBoolean()
    isEnabled: boolean;
}
