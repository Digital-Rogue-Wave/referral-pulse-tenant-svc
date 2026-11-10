import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum } from '@common/enums/billing.enum';

export class SubscriptionUpgradePreviewResponseDto {
    @ApiProperty({ enum: BillingPlanEnum })
    targetPlan!: BillingPlanEnum;

    @ApiProperty({ description: 'Integer in minor units (cents), as Stripe sends it', example: 4900 })
    amountDueNow!: number;

    @ApiProperty({ description: 'ISO 4217, lowercase, as Stripe sends it', example: 'eur' })
    currency!: string;

    @ApiPropertyOptional({ nullable: true })
    nextInvoiceDate!: Date | null;
}
