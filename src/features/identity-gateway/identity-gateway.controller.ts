import { Controller, Get, Headers, HttpStatus, Req, Res, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import type { Request, Response } from 'express';

import type { IInternalTokenClaims } from '@app/types';

import { Public } from '@common/auth/public.decorator';
import { BaseException } from '@common/exceptions/base.exceptions';
import { RawWire } from '@common/http-contract/wire-case.interceptor';

import { CredentialResolverService } from './credential-resolver.service';
import { InternalTokenService, PublicJwk } from './internal-token.service';
import { TokenExchangeCallerGuard, type TokenExchangeCaller } from './token-exchange-caller.guard';

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
 * so every service behind the gateway only ever sees internal JWTs.
 *
 * Two callers may use it, and `TokenExchangeCallerGuard` decides which proof applies: the gateway with
 * `X-Gateway-Secret` and the credential in `Authorization`, or a service with `token_exchange.call`,
 * its own token in `Authorization` and the credential in `X-Api-Key`. Event Ingestion is the second
 * caller — Architecture §12.1 lists "the Tenant token call" among its integration adapters and it is
 * the one service that receives API keys (Product Spec R-SDK-07). Before the service path existed,
 * every SDK and backend event answered 401.
 *
 * `GET /.well-known/jwks.json` publishes the verification key for every service.
 */
// Already in wire shape (JWKS is RFC 7517; the exchange body is the gateway's contract).
@RawWire()
@ApiExcludeController()
@Controller({ version: VERSION_NEUTRAL })
export class IdentityGatewayController {
    constructor(
        private readonly credentials: CredentialResolverService,
        private readonly internalTokens: InternalTokenService
    ) {}

    @Public()
    @UseGuards(TokenExchangeCallerGuard)
    @Get('internal/validate-token')
    async validateToken(
        @Headers() headers: Record<string, string | undefined>,
        @Req() request: Request & { tokenExchangeCaller?: TokenExchangeCaller },
        @Res({ passthrough: true }) response: Response
    ): Promise<ValidateTokenResponse> {
        const resolved = await this.credentials.resolve(this.extractCredential(headers, request.tokenExchangeCaller));
        response.setHeader('Authorization', `Bearer ${resolved.token}`);
        return { token: resolved.token, expires_at: resolved.expiresAt.toISOString(), claims: resolved.claims };
    }

    @Public()
    @Get('.well-known/jwks.json')
    jwks(): { keys: PublicJwk[] } {
        return this.internalTokens.jwks();
    }

    /**
     * A service caller's `Authorization` holds *its own* token, so the bearer fallback must not apply:
     * without this, a service that forgot `X-Api-Key` would hand its service token in as the credential
     * to exchange. The gateway forwards the original request's `Authorization`, so there the bearer is
     * exactly the credential.
     */
    private extractCredential(headers: Record<string, string | undefined>, caller: TokenExchangeCaller | undefined): string {
        const apiKey = headers['x-api-key'];
        if (caller === 'service') {
            if (!apiKey) {
                throw new BaseException('missing_authorization', 'A service caller must send the credential as X-Api-Key', HttpStatus.UNAUTHORIZED);
            }
            return apiKey;
        }

        const authorization = headers['authorization'];
        const bearer = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : undefined;
        const credential = apiKey ?? bearer;
        if (!credential) {
            throw new BaseException('missing_authorization', 'No API key or bearer token provided', HttpStatus.UNAUTHORIZED);
        }
        return credential;
    }
}
