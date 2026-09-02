import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import type { Request } from 'express';

import type { AllConfigType } from '@app/config/config.type';

import { HttpClientService } from '../http/http-client.service';
import { RedisKeyBuilder } from '../redis/redis-key.builder';
import { RedisService } from '../redis/redis.service';
import { TenantContextService } from '../tenant-aware/tenant-context.service';

export const IS_TENANT_API_KEY_PROTECTED_KEY = 'isTenantApiKeyProtected';

@Injectable()
export class TenantApiKeyGuard implements CanActivate {
    private readonly logger = new Logger(TenantApiKeyGuard.name);
    private readonly tenantServiceUrl: string;

    constructor(
        private readonly reflector: Reflector,
        private readonly redisService: RedisService,
        private readonly redisKeyBuilder: RedisKeyBuilder,
        private readonly tenantContext: TenantContextService,
        private readonly httpClient: HttpClientService,
        private readonly configService: ConfigService<AllConfigType>
    ) {
        this.tenantServiceUrl = this.configService.getOrThrow('services.tenants.url', { infer: true });
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isProtected = this.reflector.getAllAndOverride<boolean>(IS_TENANT_API_KEY_PROTECTED_KEY, [context.getHandler(), context.getClass()]);

        if (!isProtected) {
            return true;
        }

        const request = context.switchToHttp().getRequest<Request>();
        const apiKey = this.extractApiKey(request);

        if (!apiKey) {
            throw new UnauthorizedException('Tenant API key is missing');
        }

        const tenantId = await this.validateApiKey(apiKey);
        if (!tenantId) {
            throw new UnauthorizedException('Invalid Tenant API key');
        }

        // Set tenant context
        this.tenantContext.set('tenantId', tenantId);

        return true;
    }

    private extractApiKey(request: Request): string | undefined {
        const header = request.headers['x-tenant-api-key'];
        return Array.isArray(header) ? header[0] : header;
    }

    private async validateApiKey(apiKey: string): Promise<string | undefined> {
        const cacheKey = this.redisKeyBuilder.buildGlobalKey('api-key', apiKey);

        // 1. Check Redis cache
        const cachedTenantId = await this.redisService.get(cacheKey, {
            tenantScoped: false
        });
        if (cachedTenantId) {
            return cachedTenantId as string;
        }

        // 2. Call Tenant Service
        try {
            const response = await this.httpClient.get<{ tenantId: string }>(`${this.tenantServiceUrl}/internal/v1/api-keys/validate`, {
                params: { apiKey }
            });

            const tenantId = response.data.tenantId;

            // 3. Cache result in Redis (5 minutes)
            await this.redisService.set(cacheKey, tenantId, {
                ttl: 300,
                tenantScoped: false
            });

            return tenantId;
        } catch (error) {
            this.logger.error(`Failed to validate API key with Tenant Service: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }
}
