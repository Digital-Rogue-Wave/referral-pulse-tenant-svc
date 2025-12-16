import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum } from '@mod/common/enums/tenant.enum';

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
}
