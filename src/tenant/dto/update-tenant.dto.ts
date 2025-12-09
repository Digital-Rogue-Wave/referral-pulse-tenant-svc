import { IsString, IsOptional, IsEnum } from 'class-validator';
import { TenantStatus } from '../tenant.entity';

export class UpdateTenantDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    slug?: string;

    @IsEnum(TenantStatus)
    @IsOptional()
    status?: TenantStatus;

    @IsOptional()
    settings?: Record<string, any>;
}
