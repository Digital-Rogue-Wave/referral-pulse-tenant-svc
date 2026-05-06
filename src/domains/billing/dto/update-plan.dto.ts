import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { PlanLimits } from '../billing.types';

export class UpdatePlanDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(255)
    name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    limits?: PlanLimits | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(26)
    tenantId?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(255)
    stripeProductId?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(255)
    stripePriceId?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(50)
    interval?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    manualInvoicing?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    metadata?: Record<string, unknown> | null;
}
