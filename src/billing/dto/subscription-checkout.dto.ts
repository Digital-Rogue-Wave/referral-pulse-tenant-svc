import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { BillingPlanEnum } from '@mod/common/enums/tenant.enum';

export class SubscriptionCheckoutDto {
    @ApiProperty({
        description: 'Selected billing plan for the tenant',
        enum: BillingPlanEnum,
        enumName: 'BillingPlanEnum'
    })
    @IsEnum(BillingPlanEnum)
    plan: BillingPlanEnum;
}
