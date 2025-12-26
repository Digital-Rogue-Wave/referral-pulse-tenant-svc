import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { BillingPlanEnum } from '@mod/common/enums/billing.enum';

export class SubscriptionDowngradeRequestDto {
    @ApiProperty({
        enum: BillingPlanEnum,
        enumName: 'BillingPlanEnum'
    })
    @IsEnum(BillingPlanEnum)
    targetPlan: BillingPlanEnum;
}
