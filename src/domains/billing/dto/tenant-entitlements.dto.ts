import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * What a tenant may do right now (`GET /v1/internal/tenants/{id}/entitlements`): the plan's limits, current
 * usage against them, and the account state that gates access. A metric absent from `limits` (or null)
 * is unlimited.
 */
export class TenantEntitlementsDto {
    @ApiProperty()
    tenantId!: string;

    @ApiProperty({ example: 'Growth' })
    plan!: string;

    @ApiProperty({ example: 'active' })
    subscriptionStatus!: string;

    @ApiProperty({ example: 'active' })
    tenantStatus!: string;

    @ApiProperty({ example: 'active', description: 'active | past_due | restricted | locked' })
    paymentStatus!: string;

    @ApiPropertyOptional({ nullable: true, type: Date })
    trialEndsAt!: Date | null;

    @ApiProperty({ example: 'eu-central-1' })
    dataRegion!: string;

    @ApiProperty({ example: 24 })
    retentionMonths!: number;

    @ApiProperty({ example: { seats: 15, campaigns: 50, email_sends: 50000 } })
    limits!: Record<string, number | null>;

    @ApiProperty({ example: { seats: 4, campaigns: 12, email_sends: 1830 }, description: 'Monthly metrics are this calendar month (UTC)' })
    usage!: Record<string, number>;
}
