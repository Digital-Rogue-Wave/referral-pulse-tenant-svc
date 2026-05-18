import { IsString, IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTenantDto {
    @ApiPropertyOptional({ description: 'The name of the tenant' })
    @IsString()
    @IsOptional()
    name?: string;

    @ApiPropertyOptional({
        description: 'URL-friendly slug for the tenant. Must contain only lowercase letters, numbers, and hyphens',
        pattern: '^[a-z0-9-]+$',
    })
    @IsString()
    @IsOptional()
    @Matches(/^[a-z0-9-]+$/, {
        message: 'Slug must contain only lowercase letters, numbers, and hyphens',
    })
    slug?: string;

    @ApiPropertyOptional({
        description: 'Custom domain for the tenant (e.g. refer.acme.com)',
    })
    @IsString()
    @IsOptional()
    customDomain?: string;
}
