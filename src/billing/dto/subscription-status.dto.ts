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

    @ApiPropertyOptional({
        description: 'Indicates whether the tenant is currently in an active trial period'
    })
    trialActive?: boolean;

    @ApiPropertyOptional({
        description: 'Timestamp at which the current trial ends, when applicable'
    })
    trialEndsAt?: Date | null;

    @ApiPropertyOptional({
        description: 'Number of whole days remaining in the trial, when applicable'
    })
    trialDaysRemaining?: number | null;

    @ApiPropertyOptional({
        description: 'Approximate overall plan usage percentage for the tenant (0-100)'
    })
    planUsagePercentage?: number | null;

    @ApiPropertyOptional({
        description: 'Stripe subscription status as reported directly by Stripe, when applicable'
    })
    stripeSubscriptionStatus?: string | null;

    @ApiPropertyOptional({
        description: 'End of the current billing period for the Stripe subscription in ISO-8601 format, when applicable'
    })
    stripeCurrentPeriodEnd?: string | null;

    @ApiPropertyOptional({
        description: 'Whether the Stripe subscription is configured to cancel at the end of the current period'
    })
    stripeCancelAtPeriodEnd?: boolean | null;

    @ApiPropertyOptional({
        enum: BillingPlanEnum,
        enumName: 'BillingPlanEnum',
        description: 'If set, indicates a pending downgrade target plan that will take effect at downgradeScheduledAt'
    })
    pendingDowngradePlan?: BillingPlanEnum | null;

    @ApiPropertyOptional({
        description: 'Timestamp at which a pending downgrade will take effect, when applicable'
    })
    downgradeScheduledAt?: Date | null;

    @ApiPropertyOptional({
        description: 'Optional reason provided when the subscription was cancelled, when applicable'
    })
    cancellationReason?: string | null;

    @ApiPropertyOptional({
        description: 'Timestamp at which cancellation was requested, when applicable'
    })
    cancellationRequestedAt?: Date | null;

    @ApiPropertyOptional({
        description: 'Timestamp at which cancellation becomes or became effective, when applicable'
    })
    cancellationEffectiveAt?: Date | null;
}
