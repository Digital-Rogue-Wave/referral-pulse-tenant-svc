import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum, PaymentStatusEnum, SubscriptionStatusEnum } from '@common/enums/billing.enum';

export class SubscriptionStatusDto {
    @ApiProperty({ enum: BillingPlanEnum })
    plan!: BillingPlanEnum;

    @ApiProperty({ enum: SubscriptionStatusEnum })
    subscriptionStatus!: SubscriptionStatusEnum;

    @ApiProperty({ enum: PaymentStatusEnum })
    paymentStatus!: PaymentStatusEnum;

    @ApiPropertyOptional({ nullable: true })
    stripeCustomerId!: string | null;

    @ApiPropertyOptional({ nullable: true })
    stripeSubscriptionId!: string | null;

    @ApiPropertyOptional({ nullable: true })
    stripeTransactionId!: string | null;

    @ApiPropertyOptional({ nullable: true })
    trialActive?: boolean;

    @ApiPropertyOptional({ nullable: true })
    trialEndsAt!: Date | null;

    @ApiPropertyOptional({ nullable: true })
    trialDaysRemaining!: number | null;

    @ApiPropertyOptional({ nullable: true })
    planUsagePercentage!: number | null;

    @ApiPropertyOptional({ nullable: true })
    stripeSubscriptionStatus!: string | null;

    @ApiPropertyOptional({ nullable: true })
    stripeCurrentPeriodEnd!: string | null;

    @ApiPropertyOptional({ nullable: true })
    stripePeriodDaysRemaining!: number | null;

    @ApiPropertyOptional({ nullable: true })
    stripeCancelAtPeriodEnd!: boolean | null;

    @ApiPropertyOptional({ enum: BillingPlanEnum, nullable: true })
    pendingDowngradePlan!: BillingPlanEnum | null;

    @ApiPropertyOptional({ nullable: true })
    downgradeScheduledAt!: Date | null;

    @ApiPropertyOptional({ nullable: true })
    cancellationReason!: string | null;

    @ApiPropertyOptional({ nullable: true })
    cancellationRequestedAt!: Date | null;

    @ApiPropertyOptional({ nullable: true })
    cancellationEffectiveAt!: Date | null;
}
