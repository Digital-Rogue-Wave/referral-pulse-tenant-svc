import { Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { HttpClient } from '@mod/common/http/http.client';
import { RedisService } from '@mod/common/aws-redis/redis.service';
import { RedisKeyBuilder } from '@mod/common/aws-redis/redis-key.builder';
import { TenantStatsDto } from '../dto/stats/tenant-stats.dto';
import servicesConfig from '@mod/config/services.config';

@Injectable()
export class TenantStatsService {
    private readonly logger = new Logger(TenantStatsService.name);
    private readonly campaignServiceUrl: string;
    private readonly rewardsServiceUrl: string;
    private readonly analyticsServiceUrl: string;

    constructor(
        private readonly configService: ConfigService,
        private readonly httpClient: HttpClient,
        private readonly redisService: RedisService,
        private readonly keyBuilder: RedisKeyBuilder
    ) {
        const srvCfg = this.configService.getOrThrow<ConfigType<typeof servicesConfig>>('servicesConfig', { infer: true });
        this.campaignServiceUrl = srvCfg.campaigns;
        this.rewardsServiceUrl = srvCfg.rewards;
        this.analyticsServiceUrl = srvCfg.analytics;
    }

    async getStats(tenantId: string): Promise<TenantStatsDto> {
        const cacheKey = this.keyBuilder.build('dashboard', 'stats', tenantId);

        // 1. Try Cache
        const cached = (await this.redisService.getJson<any>(cacheKey)) as TenantStatsDto;
        if (cached) {
            this.logger.debug(`Stats cache hit for tenant ${tenantId}`);
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

        this.logger.log(`Aggregating stats for tenant ${tenantId} from external services`);

        const results = await Promise.allSettled([
            this.httpClient.get<{ count: number }>(`${this.campaignServiceUrl}/internal/tenants/${tenantId}/stats/active-count`),
            this.httpClient.get<{ count: number }>(`${this.analyticsServiceUrl}/internal/tenants/${tenantId}/stats/referrers-count`),
            this.httpClient.get<{ count: number }>(`${this.analyticsServiceUrl}/internal/tenants/${tenantId}/stats/referrals-this-month`),
            this.httpClient.get<{ amount: number }>(`${this.rewardsServiceUrl}/internal/tenants/${tenantId}/stats/total-revenue`),
            this.httpClient.get<{ amount: number }>(`${this.rewardsServiceUrl}/internal/tenants/${tenantId}/stats/pending-payouts`)
        ]);

        if (results[0].status === 'fulfilled') stats.activeCampaigns = results[0].value.data?.count || 0;
        if (results[1].status === 'fulfilled') stats.totalReferrers = results[1].value.data?.count || 0;
        if (results[2].status === 'fulfilled') stats.totalReferralsThisMonth = results[2].value.data?.count || 0;
        if (results[3].status === 'fulfilled') stats.totalRevenue = results[3].value.data?.amount || 0;
        if (results[4].status === 'fulfilled') stats.pendingPayouts = results[4].value.data?.amount || 0;

        // For plan usage, we could call billing service or use a placeholder for now
        stats.planUsagePercentage = 0; // Default or fetched from billing

        // 3. Cache results (5 minutes = 300 seconds)
        await this.redisService.setJson(cacheKey, stats as any, 300);

        return stats;
    }
}
