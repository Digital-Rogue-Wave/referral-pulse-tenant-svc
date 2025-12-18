import { ApiProperty } from '@nestjs/swagger';

export class TenantStatsDto {
    @ApiProperty({ description: 'Number of active campaigns' })
    activeCampaigns: number;

    @ApiProperty({ description: 'Total number of referrers' })
    totalReferrers: number;

    @ApiProperty({ description: 'Total number of referrals this month' })
    totalReferralsThisMonth: number;

    @ApiProperty({ description: 'Total revenue generated' })
    totalRevenue: number;

    @ApiProperty({ description: 'Total pending payouts amount' })
    pendingPayouts: number;

    @ApiProperty({
        description: 'Plan usage percentage',
        example: 75.5
    })
    planUsagePercentage: number;
}
