import { IsString, IsNotEmpty, IsArray, ArrayMinSize, IsDate } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CompareDate, DateComparisonMethod } from '@mod/common/validators/compare-date.validator';

export class CreateApiKeyDto {
    @ApiProperty({
        description: 'Friendly name for the API key',
        example: 'Production API Key'
    })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({
        description: 'Array of permission scopes for this API key',
        example: ['campaigns:read', 'campaigns:write', 'referrals:read'],
        type: [String]
    })
    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    scopes: string[];

    @ApiProperty({
        description: 'Optional expiration date for the API key',
        example: '2025-12-31T23:59:59Z',
        required: true
    })
    @IsDate()
    @Type(() => Date)
    @CompareDate(new Date(), DateComparisonMethod.GREATER)
    expiresAt: Date;
}
