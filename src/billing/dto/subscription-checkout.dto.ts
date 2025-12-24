import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { BillingPlanEnum } from '@mod/common/enums/billing.enum';

export class SubscriptionCheckoutDto {
    @ApiProperty({
        description: 'Selected billing plan for the tenant',
        enum: BillingPlanEnum,
        enumName: 'BillingPlanEnum'
    })
    @IsEnum(BillingPlanEnum)
    plan: BillingPlanEnum;

    @ApiPropertyOptional({
        description: 'Optional coupon or promotion code to apply to this subscription checkout, when applicable'
    })
    @IsOptional()
    @IsString()
    couponCode?: string;
}
