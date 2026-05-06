import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum } from '@common/enums/billing.enum';

export class SubscriptionUpgradePreviewResponseDto {
    @ApiProperty({ enum: BillingPlanEnum })
    targetPlan!: BillingPlanEnum;

    @ApiProperty()
    amountDueNow!: number;

    @ApiProperty()
    currency!: string;

    @ApiPropertyOptional({ nullable: true })
    nextInvoiceDate!: Date | null;
}
