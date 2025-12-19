import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum, SubscriptionStatusEnum } from '@mod/common/enums/tenant.enum';

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
        description: 'Stripe customer identifier associated with this tenant, when applicable'
    })
    stripeCustomerId?: string | null;

    @ApiPropertyOptional({
        description: 'Stripe subscription identifier associated with this tenant, when applicable'
    })
    stripeSubscriptionId?: string | null;
}
