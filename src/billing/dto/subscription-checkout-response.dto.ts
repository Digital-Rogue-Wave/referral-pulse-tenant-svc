import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum, PaymentStatusEnum } from '@mod/common/enums/billing.enum';

export class SubscriptionCheckoutResponseDto {
    @ApiProperty({
        enum: BillingPlanEnum,
        enumName: 'BillingPlanEnum',
        description: 'The billing plan for which checkout was initiated or completed'
    })
    plan: BillingPlanEnum;

    @ApiPropertyOptional({
        description: 'Stripe Checkout Session URL to redirect the admin to, when applicable'
    })
    checkoutUrl?: string;

    @ApiPropertyOptional({
        description: 'Stripe Checkout Session identifier, when applicable'
    })
    sessionId?: string;

    @ApiPropertyOptional({
        enum: PaymentStatusEnum,
        enumName: 'PaymentStatusEnum',
        description: 'Current payment status for the initiated subscription checkout'
    })
    paymentStatus?: PaymentStatusEnum;
}
