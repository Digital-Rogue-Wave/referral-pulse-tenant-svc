import { Controller, Get, Headers, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';

import { timingSafeEqual } from 'crypto';
import type { Response } from 'express';

import type { IInternalTokenClaims } from '@app/types';

import { Public } from '@common/auth/public.decorator';
import { BaseException } from '@common/exceptions/base.exceptions';

import type { AllConfigType } from '@config/config.type';

import { CredentialResolverService } from './credential-resolver.service';
import { InternalTokenService, PublicJwk } from './internal-token.service';

interface ValidateTokenResponse {
    token: string;
    expires_at: string;
    claims: IInternalTokenClaims;
}

/**
 * The gateway's view of tenant-service (Architecture §13.1). Not part of the public API.
 *
 * `GET /internal/validate-token` is the Traefik forwardAuth target: it exchanges the caller's credential
 * for an internal JWT and returns it in `Authorization` (listed in the middleware's `authResponseHeaders`),
 * so every service behind the gateway only ever sees internal JWTs. Only the gateway may call it — it
 * proves itself with the `X-Gateway-Secret` header.
 *
 * `GET /.well-known/jwks.json` publishes the verification key for every service.
 */
@ApiExcludeController()
@Controller({ version: VERSION_NEUTRAL })
export class IdentityGatewayController {
    private readonly gatewaySecret: Buffer;

    constructor(
        configService: ConfigService<AllConfigType>,
        private readonly credentials: CredentialResolverService,
        private readonly internalTokens: InternalTokenService
    ) {
        this.gatewaySecret = Buffer.from(configService.getOrThrow('tokenIssuer.gatewaySecret', { infer: true }));
    }

    @Public()
    @Get('internal/validate-token')
    async validateToken(
        @Headers() headers: Record<string, string | undefined>,
        @Res({ passthrough: true }) response: Response
    ): Promise<ValidateTokenResponse> {
        this.assertGateway(headers['x-gateway-secret']);

        const resolved = await this.credentials.resolve(this.extractCredential(headers));
        response.setHeader('Authorization', `Bearer ${resolved.token}`);
        return { token: resolved.token, expires_at: resolved.expiresAt.toISOString(), claims: resolved.claims };
    }

    @Public()
    @Get('.well-known/jwks.json')
    jwks(): { keys: PublicJwk[] } {
        return this.internalTokens.jwks();
    }

    private assertGateway(presented: string | undefined): void {
        const candidate = Buffer.from(presented ?? '');
        if (candidate.length !== this.gatewaySecret.length || !timingSafeEqual(candidate, this.gatewaySecret)) {
            throw new BaseException('authentication_error', 'Unknown caller', HttpStatus.UNAUTHORIZED);
        }
    }

    private extractCredential(headers: Record<string, string | undefined>): string {
        const apiKey = headers['x-api-key'];
        const authorization = headers['authorization'];
        const bearer = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : undefined;
        const credential = apiKey ?? bearer;
        if (!credential) {
            throw new BaseException('missing_authorization', 'No API key or bearer token provided', HttpStatus.UNAUTHORIZED);
        }
        return credential;
    }
}
