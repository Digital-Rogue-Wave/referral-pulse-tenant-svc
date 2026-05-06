import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PlanLimits } from '../billing.types';

export class PlanDto {
    @ApiProperty()
    id!: string;

    @ApiProperty()
    name!: string;

    @ApiPropertyOptional({ nullable: true })
    stripePriceId!: string | null;

    @ApiPropertyOptional({ nullable: true })
    stripeProductId!: string | null;

    @ApiPropertyOptional({ nullable: true })
    interval!: string | null;

    @ApiPropertyOptional({ nullable: true })
    limits!: PlanLimits | null;

    @ApiPropertyOptional({ nullable: true })
    tenantId!: string | null;

    @ApiProperty()
    isActive!: boolean;

    @ApiProperty()
    manualInvoicing!: boolean;

    @ApiPropertyOptional({ nullable: true })
    metadata!: Record<string, unknown> | null;

    @ApiProperty()
    createdAt!: Date;

    @ApiProperty()
    updatedAt!: Date;

    @ApiPropertyOptional({ nullable: true })
    deletedAt!: Date | null;
}
