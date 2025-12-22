import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum, SubscriptionStatusEnum, PaymentStatusEnum } from '@mod/common/enums/billing.enum';

export class SubscriptionStatusDto {
    @ApiProperty({
        enum: BillingPlanEnum,
        enumName: 'BillingPlanEnum',
        description: 'The current billing plan of the tenant'
    })
    plan: BillingPlanEnum;

    @ApiProperty({
        enum: SubscriptionStatusEnum,
        enumName: 'SubscriptionStatusEnum',
        description: 'The subscription status of the tenant'
    })
    subscriptionStatus: SubscriptionStatusEnum;

    @ApiPropertyOptional({
        enum: PaymentStatusEnum,
        enumName: 'PaymentStatusEnum',
        description: 'Derived payment status for the tenant subscription'
    })
    paymentStatus?: PaymentStatusEnum;

    @ApiPropertyOptional({
        description: 'Stripe customer identifier associated with this tenant, when applicable'
    })
    stripeCustomerId?: string | null;

    @ApiPropertyOptional({
        description: 'Stripe subscription identifier associated with this tenant, when applicable'
    })
    stripeSubscriptionId?: string | null;

    @ApiPropertyOptional({
        description: 'Stripe transaction (Payment Intent) identifier associated with the latest billing event, when applicable'
    })
    stripeTransactionId?: string | null;
}
