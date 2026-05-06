import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum } from '@common/enums/billing.enum';

export class UsageMetricHistoryPointDto {
    @ApiProperty()
    periodDate!: string;

    @ApiProperty()
    usage!: number;
}

export class UsageMetricSummaryDto {
    @ApiProperty()
    metric!: string;

    @ApiProperty()
    currentUsage!: number;

    @ApiPropertyOptional({ nullable: true })
    limit!: number | null;

    @ApiPropertyOptional({ nullable: true })
    percentageUsed!: number | null;

    @ApiProperty({ type: () => UsageMetricHistoryPointDto, isArray: true })
    history!: UsageMetricHistoryPointDto[];
}

export class UsageSummaryDto {
    @ApiProperty({ enum: BillingPlanEnum })
    plan!: BillingPlanEnum;

    @ApiProperty({ type: () => UsageMetricSummaryDto, isArray: true })
    metrics!: UsageMetricSummaryDto[];
}
