import { Controller, Get, Headers, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags, ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { Public } from '@common/auth/public.decorator';

import { TokenResolverService, ValidateTokenResult } from './token-resolver.service';

/**
 * Internal token-resolution endpoint (system_architecture — /internal/validate-token).
 * Version-neutral: internal endpoints are unversioned in the spec (only public APIs carry /v1).
 * Called by the gateway / auth guard to resolve an API key or OAuth2 JWT to internal claims.
 * Public to our guards because it resolves the credential itself.
 */
@ApiTags('Internal')
@Controller({ path: 'internal', version: VERSION_NEUTRAL })
export class InternalAuthController {
    constructor(private readonly tokenResolver: TokenResolverService) {}

    @Public()
    @Get('validate-token')
    @ApiOperation({ summary: 'Resolve an API key or OAuth2 JWT to internal claims' })
    @ApiOkResponse({ description: 'Resolved tenant_id, scopes, source, key_type and user_id' })
    async validateToken(@Headers() headers: Record<string, string | undefined>): Promise<ValidateTokenResult> {
        const apiKey = headers['x-api-key'] ?? headers['x-tenant-api-key'];
        const authorization = headers['authorization'];
        const bearer = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;

        return this.tokenResolver.resolve(apiKey, bearer);
    }
}
