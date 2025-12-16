import { IsString, IsArray, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateApiKeyDto {
    @ApiPropertyOptional({
        description: 'Updated friendly name for the API key',
        example: 'Production API Key - Updated',
        required: false
    })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional({
        description: 'Updated array of permission scopes',
        example: ['campaigns:read', 'referrals:read'],
        type: [String],
        required: false
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    scopes?: string[];
}
