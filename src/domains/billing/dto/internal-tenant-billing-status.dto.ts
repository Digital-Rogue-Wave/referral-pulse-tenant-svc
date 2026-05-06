import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum, PaymentStatusEnum, SubscriptionStatusEnum } from '@common/enums/billing.enum';
import { TenantStatusEnum } from '@common/enums/tenant.enum';

export class InternalTenantBillingStatusDto {
    @ApiProperty()
    tenantId!: string;

    @ApiProperty({ enum: TenantStatusEnum })
    tenantStatus!: TenantStatusEnum;

    @ApiProperty({ enum: PaymentStatusEnum })
    paymentStatus!: PaymentStatusEnum;

    @ApiPropertyOptional({ nullable: true })
    trialStartedAt!: Date | null;

    @ApiPropertyOptional({ nullable: true })
    trialEndsAt!: Date | null;

    @ApiProperty({ enum: BillingPlanEnum })
    plan!: BillingPlanEnum;

    @ApiProperty({ enum: SubscriptionStatusEnum })
    subscriptionStatus!: SubscriptionStatusEnum;

    @ApiPropertyOptional({ nullable: true })
    stripeCustomerId!: string | null;

    @ApiPropertyOptional({ nullable: true })
    stripeSubscriptionId!: string | null;
}
