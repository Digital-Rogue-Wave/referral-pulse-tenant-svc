import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntityHelperDto } from '@common/models/entity-helper.dto';
import type { PlanLimits } from '@app/features/billing/plan-limits.type';

export class PlanDto extends EntityHelperDto {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    name!: string;

    @ApiPropertyOptional()
    stripePriceId?: string | null;

    @ApiPropertyOptional()
    stripeProductId?: string | null;

    @ApiPropertyOptional()
    interval?: string | null;

    @ApiPropertyOptional()
    limits?: PlanLimits | null;

    @ApiPropertyOptional()
    tenantId?: string | null;

    @ApiProperty()
    isActive!: boolean;

    @ApiProperty()
    manualInvoicing!: boolean;

    @ApiPropertyOptional()
    metadata?: Record<string, unknown> | null;
}
