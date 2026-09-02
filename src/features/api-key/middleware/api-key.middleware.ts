import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { ApiKeyService } from '../api-key.service';

@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {
    constructor(
        private readonly apiKeyService: ApiKeyService,
        private readonly tenantContext: TenantContextService
    ) {}

    async use(req: Request, res: Response, next: NextFunction) {
        const apiKeyHeader = req.headers['x-api-key'];

        if (apiKeyHeader) {
            const apiKey = await this.apiKeyService.validateKey(apiKeyHeader as string);

            if (!apiKey) {
                throw new UnauthorizedException('Invalid or expired API Key');
            }

            // Set context
            this.tenantContext.set('tenantId', apiKey.tenantId);
            this.tenantContext.set('userId', apiKey.createdBy);
            this.tenantContext.set('route', req.route?.path);
            this.tenantContext.set('ip', req.ip);
            this.tenantContext.set('userAgent', req.headers['user-agent']);

            // Set request.user for legacy compatibility
            req['user'] = {
                id: apiKey.createdBy,
                tenantId: apiKey.tenantId,
                viaApiKey: true,
                scopes: apiKey.scopes
            };
        }

        next();
    }
}
