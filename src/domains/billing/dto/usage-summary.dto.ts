import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One usage counter of `GET /v1/billing/plan` (v5.2 API: current plan, period, usage counters). */
export class UsageMetricSummaryDto {
    @ApiProperty()
    metric!: string;

    @ApiProperty()
    currentUsage!: number;

    @ApiPropertyOptional({ nullable: true })
    limit!: number | null;

    @ApiPropertyOptional({ nullable: true })
    percentageUsed!: number | null;
}
