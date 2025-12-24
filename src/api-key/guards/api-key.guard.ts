import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ApiKeyService } from '../api-key.service';
import { ClsService } from 'nestjs-cls';
import { ClsRequestContext } from '@mod/domains/context/cls-request-context';

@Injectable()
export class ApiKeyGuard implements CanActivate {
    constructor(
        private readonly apiKeyService: ApiKeyService,
        private readonly cls: ClsService<ClsRequestContext>
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const apiKeyHeader = request.headers['x-api-key'];

        if (!apiKeyHeader) {
            // If no API key is present, we return true to allow other guards (like JWT) to handle it?
            // Or if this guard is explicitly used, it should fail?
            // Usually if a specific endpoint requires API Key, it should fail.
            // If it's global middleware, it might perform a check.
            // Assuming this guard is used via @UseGuards(ApiKeyGuard), it MUST validate.
            // But checking the implementation of JwtAuthGuard, it throws.
            throw new UnauthorizedException('API Key missing');
        }

        const apiKey = await this.apiKeyService.validateKey(apiKeyHeader as string);

        if (!apiKey) {
            throw new HttpException({ message: 'Invalid or expired API Key' }, HttpStatus.EXPECTATION_FAILED);
        }

        // Set CLS Context
        this.cls.set('tenantId', apiKey.tenantId);
        this.cls.set('userId', apiKey.createdBy); // Use creator as the actor
        this.cls.set('route', request.route.path);
        this.cls.set('ip', request.ip);
        this.cls.set('userAgent', request.headers['user-agent']);

        // Set request.user for legacy compatibility if needed
        request.user = {
            id: apiKey.createdBy,
            tenantId: apiKey.tenantId,
            viaApiKey: true
        };

        return true;
    }
}
