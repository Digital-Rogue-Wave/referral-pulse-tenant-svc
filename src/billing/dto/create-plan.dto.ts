import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { PlanLimits } from '../plan-limits.type';

export class CreatePlanDto {
    @ApiProperty({ description: 'Display name of the plan' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiPropertyOptional({ description: 'Associated Stripe price ID' })
    @IsOptional()
    @IsString()
    stripePriceId?: string | null;

    @ApiPropertyOptional({ description: 'Associated Stripe product ID' })
    @IsOptional()
    @IsString()
    stripeProductId?: string | null;

    @ApiPropertyOptional({ description: 'Billing interval for the plan (e.g. month, year)' })
    @IsOptional()
    @IsString()
    interval?: string | null;

    @ApiPropertyOptional({ description: 'Limits configuration for this plan' })
    @IsOptional()
    @IsObject()
    limits?: PlanLimits | null;

    @ApiPropertyOptional({ description: 'Tenant this plan is specific to (null = public plan)' })
    @IsOptional()
    @IsUUID()
    tenantId?: string | null;

    @ApiPropertyOptional({ description: 'Whether the plan is currently active', default: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({ description: 'Whether this plan uses manual invoicing (enterprise only)', default: false })
    @IsOptional()
    @IsBoolean()
    manualInvoicing?: boolean;

    @ApiPropertyOptional({ description: 'Arbitrary plan metadata' })
    @IsOptional()
    @IsObject()
    metadata?: Record<string, any> | null;
}
