import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum, PaymentStatusEnum } from '@common/enums/billing.enum';

export class SubscriptionCheckoutResponseDto {
    @ApiProperty({ enum: BillingPlanEnum })
    plan!: BillingPlanEnum;

    @ApiPropertyOptional({ nullable: true })
    checkoutUrl?: string;

    @ApiProperty()
    sessionId!: string;

    @ApiProperty({ enum: PaymentStatusEnum })
    paymentStatus!: PaymentStatusEnum;
}
