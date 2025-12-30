import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum } from '@mod/common/enums/billing.enum';

export class UsageMetricHistoryPointDto {
    @ApiProperty()
    periodDate: string;

    @ApiProperty()
    usage: number;
}

export class UsageMetricSummaryDto {
    @ApiProperty()
    metric: string;

    @ApiProperty()
    currentUsage: number;

    @ApiPropertyOptional({ description: 'Configured plan limit for this metric, if available' })
    limit?: number | null;

    @ApiPropertyOptional({ description: 'Percentage of the limit used, if limit is known' })
    percentageUsed?: number | null;

    @ApiProperty({ type: UsageMetricHistoryPointDto, isArray: true })
    history: UsageMetricHistoryPointDto[];
}

export class UsageSummaryDto {
    @ApiProperty({ enum: BillingPlanEnum })
    plan: BillingPlanEnum;

    @ApiProperty({ type: UsageMetricSummaryDto, isArray: true })
    metrics: UsageMetricSummaryDto[];
}
