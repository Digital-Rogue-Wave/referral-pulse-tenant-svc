import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { BillingPlanEnum } from '@common/enums/billing.enum';

export class SubscriptionDowngradeRequestDto {
    @ApiProperty({ enum: BillingPlanEnum })
    @IsEnum(BillingPlanEnum)
    targetPlan!: BillingPlanEnum;
}
