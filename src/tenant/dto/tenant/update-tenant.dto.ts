import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';

export class UpdateTenantDto {
    @ApiPropertyOptional({ description: 'The name of the tenant' })
    @IsString()
    @IsOptional()
    name?: string;

    @ApiPropertyOptional({
        description: 'URL-friendly slug for the tenant. Must contain only lowercase letters, numbers, and hyphens',
        pattern: '^[a-z0-9-]+$'
    })
    @IsString()
    @IsOptional()
    slug?: string;

    @ApiPropertyOptional({
        description: 'The status of the tenant',
        enum: TenantStatusEnum,
        enumName: 'TenantStatusEnum'
    })
    @IsEnum(TenantStatusEnum)
    @IsOptional()
    status?: TenantStatusEnum;

    @ApiPropertyOptional({
        description: 'Custom settings for the tenant'
    })
    @IsOptional()
    settings?: Record<string, any>;

    @ApiPropertyOptional({
        description: 'Custom domain for the tenant (e.g. refer.acme.com)'
    })
    @IsString()
    @IsOptional()
    customDomain?: string;
}
