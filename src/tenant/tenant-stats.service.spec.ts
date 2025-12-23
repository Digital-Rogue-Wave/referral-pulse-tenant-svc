import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpClient } from '@mod/common/http/http.client';
import { RedisService } from '@mod/common/aws-redis/redis.service';
import { RedisKeyBuilder } from '@mod/common/aws-redis/redis-key.builder';
import { TeamMemberService } from '@mod/team-member/team-member.service';
import { TenantStatsService } from './tenant-stats.service';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { TenantStatsDto } from './dto/stats/tenant-stats.dto';

describe('TenantStatsService', () => {
    let service: TenantStatsService;
    let configService: DeepMocked<ConfigService>;
    let httpClient: DeepMocked<HttpClient>;
    let redisService: DeepMocked<RedisService>;
    let keyBuilder: DeepMocked<RedisKeyBuilder>;
    let teamMemberService: DeepMocked<TeamMemberService>;

    const tenantId = 'tenant-123';
    const cacheKey = 'cache-key';

    beforeEach(async () => {
        configService = createMock<ConfigService>();
        httpClient = createMock<HttpClient>();
        redisService = createMock<RedisService>();
        keyBuilder = createMock<RedisKeyBuilder>();
        teamMemberService = createMock<TeamMemberService>();

        configService.getOrThrow.mockReturnValue({
            campaigns: 'http://campaigns',
            rewards: 'http://rewards',
            analytics: 'http://analytics'
        });

        keyBuilder.build.mockReturnValue(cacheKey);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantStatsService,
                { provide: ConfigService, useValue: configService },
                { provide: HttpClient, useValue: httpClient },
                { provide: RedisService, useValue: redisService },
                { provide: RedisKeyBuilder, useValue: keyBuilder },
                { provide: TeamMemberService, useValue: teamMemberService }
            ]
        }).compile();

        service = module.get<TenantStatsService>(TenantStatsService);
    });

    it('should return cached stats if available', async () => {
        const cachedStats: TenantStatsDto = {
            activeCampaigns: 5,
            totalReferrers: 10,
            totalReferralsThisMonth: 15,
            totalRevenue: 1000,
            pendingPayouts: 200,
            planUsagePercentage: 50
        };
        redisService.getJson.mockResolvedValue(cachedStats as any);

        const result = await service.getStats(tenantId);

        expect(result).toEqual(cachedStats);
        expect(httpClient.get).not.toHaveBeenCalled();
    });

    it('should aggregate stats from external services and cache them', async () => {
        redisService.getJson.mockResolvedValue(null);
        teamMemberService.countMembers.mockResolvedValue(5);

        httpClient.get.mockImplementation((url: string) => {
            if (url.includes('active-count'))
                return Promise.resolve({ data: { count: 1 }, status: 200, statusText: 'OK', headers: {}, config: {} } as any);
            if (url.includes('referrers-count'))
                return Promise.resolve({ data: { count: 2 }, status: 200, statusText: 'OK', headers: {}, config: {} } as any);
            if (url.includes('referrals-this-month'))
                return Promise.resolve({ data: { count: 3 }, status: 200, statusText: 'OK', headers: {}, config: {} } as any);
            if (url.includes('total-revenue'))
                return Promise.resolve({ data: { amount: 100 }, status: 200, statusText: 'OK', headers: {}, config: {} } as any);
            if (url.includes('pending-payouts'))
                return Promise.resolve({ data: { amount: 10 }, status: 200, statusText: 'OK', headers: {}, config: {} } as any);
            return Promise.reject(new Error('Unknown URL'));
        });

        const result = await service.getStats(tenantId);

        expect(result.activeCampaigns).toBe(1);
        expect(result.totalReferrers).toBe(2);
        expect(result.totalReferralsThisMonth).toBe(3);
        expect(result.totalRevenue).toBe(100);
        expect(result.pendingPayouts).toBe(10);
        expect(result.planUsagePercentage).toBe(50); // 5 members / 10 limit

        expect(redisService.setJson).toHaveBeenCalledWith(cacheKey, result, 300);
    });

    it('should handle partial failures from external services', async () => {
        redisService.getJson.mockResolvedValue(null);
        teamMemberService.countMembers.mockResolvedValue(0);

        httpClient.get.mockImplementation((url: string) => {
            if (url.includes('active-count'))
                return Promise.resolve({ data: { count: 1 }, status: 200, statusText: 'OK', headers: {}, config: {} } as any);
            return Promise.reject(new Error('Service Down'));
        });

        const result = await service.getStats(tenantId);

        expect(result.activeCampaigns).toBe(1);
        expect(result.totalReferrers).toBe(0); // Failed call
        expect(result.totalRevenue).toBe(0); // Failed call
    });
});
