import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPlanEnum, PaymentStatusEnum, SubscriptionStatusEnum } from '@common/enums/billing.enum';
import { TenantStatus } from '@domains/tenant/tenant.types';

export class InternalTenantBillingStatusDto {
    @ApiProperty()
    tenantId!: string;

    @ApiProperty({ enum: TenantStatus })
    tenantStatus!: TenantStatus;

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
