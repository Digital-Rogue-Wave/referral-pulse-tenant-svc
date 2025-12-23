import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../api-key.service';
import { ClsService } from 'nestjs-cls';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';

@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {
    constructor(
        private readonly apiKeyService: ApiKeyService,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    async use(req: Request, res: Response, next: NextFunction) {
        const apiKeyHeader = req.headers['x-api-key'];

        if (apiKeyHeader) {
            const apiKey = await this.apiKeyService.validateKey(apiKeyHeader as string);

            if (!apiKey) {
                throw new UnauthorizedException('Invalid or expired API Key');
            }

            // Set CLS Context
            this.cls.set('tenantId', apiKey.tenantId);
            this.cls.set('userId', apiKey.createdBy);
            this.cls.set('route', req.route?.path);
            this.cls.set('ip', req.ip);
            this.cls.set('userAgent', req.headers['user-agent']);

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
