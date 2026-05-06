import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { BillingPlanEnum } from '@common/enums/billing.enum';

export class SubscriptionCheckoutDto {
    @ApiProperty({ enum: BillingPlanEnum })
    @IsEnum(BillingPlanEnum)
    plan!: BillingPlanEnum;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(100)
    couponCode?: string;
}
