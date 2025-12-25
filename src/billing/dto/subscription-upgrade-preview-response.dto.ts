import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum } from '@mod/common/enums/billing.enum';

export class SubscriptionUpgradePreviewResponseDto {
    @ApiProperty({
        enum: BillingPlanEnum,
        enumName: 'BillingPlanEnum'
    })
    targetPlan: BillingPlanEnum;

    @ApiProperty()
    amountDueNow: number;

    @ApiProperty()
    currency: string;

    @ApiPropertyOptional()
    nextInvoiceDate?: Date | null;
}
