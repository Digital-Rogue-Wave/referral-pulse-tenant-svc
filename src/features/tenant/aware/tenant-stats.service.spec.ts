import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import { HttpClientService } from '@common/http/http-client.service';
import { RedisService } from '@common/redis/redis.service';
import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DatabaseService } from '@app/database/database.service';

import { TenantStatsDto } from '@domains/tenant';

import { TenantStatsService } from './tenant-stats.service';

describe('TenantStatsService', () => {
    let service: TenantStatsService;
    let configService: MockProxy<ConfigService>;
    let httpClient: MockProxy<HttpClientService>;
    let redisService: MockProxy<RedisService>;
    let prisma: MockProxy<DatabaseService>;
    let tenantContext: MockProxy<TenantContextService>;
    let logger: MockProxy<AppLoggerService>;

    const tenantId = 'tenant-123';

    beforeEach(async () => {
        configService = mock<ConfigService>();
        httpClient = mock<HttpClientService>();
        redisService = mock<RedisService>();
        prisma = mock<DatabaseService>();
        tenantContext = mock<TenantContextService>();
        logger = mock<AppLoggerService>();

        prisma.user = { count: jest.fn() } as never;

        configService.getOrThrow.mockReturnValue({
            campaigns: 'http://campaigns',
            rewards: 'http://rewards',
            analytics: 'http://analytics'
        });

        tenantContext.getTenantId.mockReturnValue(tenantId);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantStatsService,
                { provide: ConfigService, useValue: configService },
                { provide: HttpClientService, useValue: httpClient },
                { provide: RedisService, useValue: redisService },
                { provide: DatabaseService, useValue: prisma },
                { provide: TenantContextService, useValue: tenantContext },
                { provide: AppLoggerService, useValue: logger }
            ]
        }).compile();

        service = module.get<TenantStatsService>(TenantStatsService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
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
        redisService.get.mockResolvedValue(cachedStats);

        const result = await service.getStats();

        expect(result).toEqual(cachedStats);
        expect(httpClient.get).not.toHaveBeenCalled();
    });

    it('should aggregate stats from external services and cache them', async () => {
        redisService.get.mockResolvedValue(undefined);
        (prisma.user.count as jest.Mock).mockResolvedValue(5);

        httpClient.get.mockImplementation((url: string) => {
            if (url.includes('active-count')) return Promise.resolve({ data: { count: 1 } });
            if (url.includes('referrers-count')) return Promise.resolve({ data: { count: 2 } });
            if (url.includes('referrals-this-month')) return Promise.resolve({ data: { count: 3 } });
            if (url.includes('total-revenue')) return Promise.resolve({ data: { amount: 100 } });
            if (url.includes('pending-payouts')) return Promise.resolve({ data: { amount: 10 } });
            return Promise.reject(new Error('Unknown URL'));
        });

        const result = await service.getStats();

        expect(result.activeCampaigns).toBe(1);
        expect(result.totalReferrers).toBe(2);
        expect(result.totalReferralsThisMonth).toBe(3);
        expect(result.totalRevenue).toBe(100);
        expect(result.pendingPayouts).toBe(10);
        expect(result.planUsagePercentage).toBe(50); // 5 users / 10 limit

        expect(redisService.set).toHaveBeenCalledWith(`dashboard:stats:${tenantId}`, result, { ttl: 300 });
    });

    it('should handle partial failures from external services', async () => {
        redisService.get.mockResolvedValue(undefined);
        (prisma.user.count as jest.Mock).mockResolvedValue(0);

        httpClient.get.mockImplementation((url: string) => {
            if (url.includes('active-count')) return Promise.resolve({ data: { count: 1 } });
            return Promise.reject(new Error('Service Down'));
        });

        const result = await service.getStats();

        expect(result.activeCampaigns).toBe(1);
        expect(result.totalReferrers).toBe(0);
        expect(result.totalRevenue).toBe(0);
    });
});
