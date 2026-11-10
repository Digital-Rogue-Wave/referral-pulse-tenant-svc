import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';

import { HttpClientService } from '@common/http/http-client.service';
import { RedisService } from '@common/redis/redis.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import servicesConfig from '@config/services.config';

import { DatabaseService } from '@app/database/database.service';
import { TenantStatsDto } from '@domains/tenant';
import { PlanLimitService, SEATS_METRIC } from '@app/features/billing/plan-limit.service';

@Injectable()
export class TenantStatsService {
    private readonly campaignServiceUrl: string;
    private readonly rewardsServiceUrl: string;
    private readonly analyticsServiceUrl: string;

    constructor(
        private readonly configService: ConfigService,
        private readonly httpClient: HttpClientService,
        private readonly redisService: RedisService,
        private readonly prisma: DatabaseService,
        private readonly tenantContext: TenantContextService,
        private readonly logger: AppLoggerService,
        private readonly planLimits: PlanLimitService
    ) {
        this.logger.setContext(TenantStatsService.name);

        const srvCfg = this.configService.getOrThrow<ConfigType<typeof servicesConfig>>('services', {
            infer: true
        });
        this.campaignServiceUrl = srvCfg.campaigns.url;
        this.rewardsServiceUrl = srvCfg.rewards.url;
        this.analyticsServiceUrl = srvCfg.analytics.url;
    }

    async getStats(): Promise<TenantStatsDto> {
        const tenantId = this.tenantContext.getTenantId()!;
        const cacheKey = `dashboard:stats:${tenantId}`;

        // 1. Try Cache
        const cached = await this.redisService.get<TenantStatsDto>(cacheKey);
        if (cached) {
            this.logger.debug(`Stats cache hit for tenant ${tenantId}`, { tenantId });
            return cached;
        }

        // 2. Aggregate from multiple services
        const stats: TenantStatsDto = {
            activeCampaigns: 0,
            totalReferrers: 0,
            totalReferralsThisMonth: 0,
            totalRevenue: 0,
            pendingPayouts: 0,
            planUsagePercentage: 0
        };

        this.logger.log(`Aggregating stats for tenant ${tenantId} from external services`, { tenantId });

        const results = await Promise.allSettled([
            this.httpClient.get<{ count: number }>(`${this.campaignServiceUrl}/internal/tenants/${tenantId}/stats/active-count`),
            this.httpClient.get<{ count: number }>(`${this.analyticsServiceUrl}/internal/tenants/${tenantId}/stats/referrers-count`),
            this.httpClient.get<{ count: number }>(`${this.analyticsServiceUrl}/internal/tenants/${tenantId}/stats/referrals-this-month`),
            this.httpClient.get<{ amount: number }>(`${this.rewardsServiceUrl}/internal/tenants/${tenantId}/stats/total-revenue`),
            this.httpClient.get<{ amount: number }>(`${this.rewardsServiceUrl}/internal/tenants/${tenantId}/stats/pending-payouts`)
        ]);

        if (results[0].status === 'fulfilled') {
            stats.activeCampaigns = results[0].value.data?.count || 0;
        }
        if (results[1].status === 'fulfilled') {
            stats.totalReferrers = results[1].value.data?.count || 0;
        }
        if (results[2].status === 'fulfilled') {
            stats.totalReferralsThisMonth = results[2].value.data?.count || 0;
        }
        if (results[3].status === 'fulfilled') {
            stats.totalRevenue = results[3].value.data?.amount || 0;
        }
        if (results[4].status === 'fulfilled') {
            stats.pendingPayouts = results[4].value.data?.amount || 0;
        }

        stats.planUsagePercentage = await this.seatUsagePercentage(tenantId);

        // 3. Cache results (5 minutes = 300 seconds)
        await this.redisService.set(cacheKey, stats, { ttl: 300 });

        return stats;
    }

    /**
     * US1.8.1 F3: seats in use (members plus open invitations, as the seat limit counts them) over the plan's
     * seat limit. A plan without a seat limit is never "full", so it reads 0.
     */
    private async seatUsagePercentage(tenantId: string): Promise<number> {
        const seatLimit = (await this.planLimits.getPlanLimits(tenantId))?.[SEATS_METRIC];
        if (!seatLimit) {
            return 0;
        }
        return Math.min(((await this.planLimits.seatsInUse(tenantId)) / seatLimit) * 100, 100);
    }
}
