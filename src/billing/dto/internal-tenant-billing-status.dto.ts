import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum, PaymentStatusEnum, SubscriptionStatusEnum } from '@mod/common/enums/billing.enum';
import { TenantStatusEnum } from '@mod/common/enums/tenant.enum';

export class InternalTenantBillingStatusDto {
    @ApiProperty({ description: 'Tenant identifier' })
    tenantId: string;

    @ApiProperty({
        enum: TenantStatusEnum,
        enumName: 'TenantStatusEnum',
        description: 'Tenant account status (security/admin state)'
    })
    tenantStatus: TenantStatusEnum;

    @ApiProperty({
        enum: PaymentStatusEnum,
        enumName: 'PaymentStatusEnum',
        description: 'Tenant payment enforcement state'
    })
    paymentStatus: PaymentStatusEnum;

    @ApiProperty({
        enum: BillingPlanEnum,
        enumName: 'BillingPlanEnum',
        description: 'Current billing plan'
    })
    plan: BillingPlanEnum;

    @ApiProperty({
        enum: SubscriptionStatusEnum,
        enumName: 'SubscriptionStatusEnum',
        description: 'Current subscription status'
    })
    subscriptionStatus: SubscriptionStatusEnum;

    @ApiPropertyOptional({ description: 'Trial start timestamp, when applicable' })
    trialStartedAt?: Date | null;

    @ApiPropertyOptional({ description: 'Trial end timestamp, when applicable' })
    trialEndsAt?: Date | null;

    @ApiPropertyOptional({ description: 'Stripe customer identifier, when applicable' })
    stripeCustomerId?: string | null;

    @ApiPropertyOptional({ description: 'Stripe subscription identifier, when applicable' })
    stripeSubscriptionId?: string | null;
}
