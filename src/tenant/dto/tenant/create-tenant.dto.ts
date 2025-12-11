import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTenantDto {
    @ApiProperty({ description: 'The name of the tenant' })
    @IsString()
    @IsNotEmpty()
    name!: string;

    @ApiPropertyOptional({
        description: 'URL-friendly slug for the tenant. Must contain only lowercase letters, numbers, and hyphens',
        pattern: '^[a-z0-9-]+$'
    })
    @IsString()
    @IsOptional()
    @Matches(/^[a-z0-9-]+$/, { message: 'Slug must contain only lowercase letters, numbers, and hyphens' })
    slug?: string;

    @ApiPropertyOptional({ description: 'The ID of the tenant owner' })
    @IsString()
    @IsOptional()
    ownerId?: string;
}
