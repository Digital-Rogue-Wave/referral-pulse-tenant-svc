import { CanActivate, ExecutionContext, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';

import { TenantContextService } from '@common/tenant-aware/tenant-context.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { ErrorCode } from '@app/types/app.type';
import { ApiKeyService } from '../api-key.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
    constructor(
        private readonly apiKeyService: ApiKeyService,
        private readonly tenantContext: TenantContextService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const apiKeyHeader = request.headers['x-api-key'];

        if (!apiKeyHeader) {
            throw new UnauthorizedException('API Key missing');
        }

        const apiKey = await this.apiKeyService.validateKey(apiKeyHeader as string);

        if (!apiKey) {
            throw new BaseException('INVALID_API_KEY' as ErrorCode, 'Invalid or expired API Key', HttpStatus.EXPECTATION_FAILED);
        }

        // Set context
        this.tenantContext.set('tenantId', apiKey.tenantId);
        this.tenantContext.set('userId', apiKey.createdBy);
        this.tenantContext.set('route', request.route?.path);
        this.tenantContext.set('ip', request.ip);
        this.tenantContext.set('userAgent', request.headers['user-agent']);

        // Set request.user for legacy compatibility
        request.user = {
            id: apiKey.createdBy,
            tenantId: apiKey.tenantId,
            viaApiKey: true,
        };

        return true;
    }
}
