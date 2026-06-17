import { Test, TestingModule } from '@nestjs/testing';
import { TenantApiKeyGuard } from './tenant-api-key.guard';
import { Reflector } from '@nestjs/core';
import { RedisService } from '../redis/redis.service';
import { RedisKeyBuilder } from '../redis/redis-key.builder';
import { TenantContextService } from '../tenant-aware/tenant-context.service';
import { HttpClientService } from '../http/http-client.service';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

describe('TenantApiKeyGuard', () => {
    let guard: TenantApiKeyGuard;
    let reflector: Reflector;
    let redisService: RedisService;
    let httpClient: HttpClientService;
    let tenantContext: TenantContextService;

    const mockTenantId = 'tenant-123';
    const mockApiKey = 'test-api-key';

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantApiKeyGuard,
                {
                    provide: Reflector,
                    useValue: {
                        getAllAndOverride: jest.fn()
                    }
                },
                {
                    provide: RedisService,
                    useValue: {
                        get: jest.fn(),
                        set: jest.fn()
                    }
                },
                {
                    provide: RedisKeyBuilder,
                    useValue: {
                        buildGlobalKey: jest.fn().mockReturnValue('api-key:test')
                    }
                },
                {
                    provide: TenantContextService,
                    useValue: {
                        set: jest.fn()
                    }
                },
                {
                    provide: HttpClientService,
                    useValue: {
                        get: jest.fn()
                    }
                },
                {
                    provide: ConfigService,
                    useValue: {
                        getOrThrow: jest.fn().mockReturnValue('http://tenant-service')
                    }
                }
            ]
        }).compile();

        guard = module.get<TenantApiKeyGuard>(TenantApiKeyGuard);
        reflector = module.get<Reflector>(Reflector);
        redisService = module.get<RedisService>(RedisService);
        httpClient = module.get<HttpClientService>(HttpClientService);
        tenantContext = module.get<TenantContextService>(TenantContextService);
    });

    it('should be defined', () => {
        expect(guard).toBeDefined();
    });

    it('should return true if route is not protected', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
        const context = {
            getHandler: jest.fn(),
            getClass: jest.fn()
        } as unknown as ExecutionContext;

        expect(await guard.canActivate(context)).toBe(true);
    });

    it('should throw UnauthorizedException if API key is missing', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
        const context = {
            getHandler: jest.fn(),
            getClass: jest.fn(),
            switchToHttp: jest.fn().mockReturnValue({
                getRequest: jest.fn().mockReturnValue({
                    headers: {}
                })
            })
        } as unknown as ExecutionContext;

        await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should validate API key from cache and set tenant context', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
        jest.spyOn(redisService, 'get').mockResolvedValue(mockTenantId);

        const context = {
            getHandler: jest.fn(),
            getClass: jest.fn(),
            switchToHttp: jest.fn().mockReturnValue({
                getRequest: jest.fn().mockReturnValue({
                    headers: { 'x-tenant-api-key': mockApiKey }
                })
            })
        } as unknown as ExecutionContext;

        expect(await guard.canActivate(context)).toBe(true);
        expect(tenantContext.set).toHaveBeenCalledWith('tenantId', mockTenantId);
    });

    it('should validate API key from service if not in cache', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
        jest.spyOn(redisService, 'get').mockResolvedValue(null);
        jest.spyOn(httpClient, 'get').mockResolvedValue({
            data: { tenantId: mockTenantId },
            status: 200,
            headers: {},
            duration: 10
        } as any);

        const context = {
            getHandler: jest.fn(),
            getClass: jest.fn(),
            switchToHttp: jest.fn().mockReturnValue({
                getRequest: jest.fn().mockReturnValue({
                    headers: { 'x-tenant-api-key': mockApiKey }
                })
            })
        } as unknown as ExecutionContext;

        expect(await guard.canActivate(context)).toBe(true);
        expect(redisService.set).toHaveBeenCalled();
        expect(tenantContext.set).toHaveBeenCalledWith('tenantId', mockTenantId);
    });
});
