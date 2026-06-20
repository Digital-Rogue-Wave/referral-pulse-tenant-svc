import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';

import { AppLoggerService } from '@common/logging/app-logger.service';
import { ApiKeyService } from '@app/features/api-key/api-key.service';
import type { AllConfigType } from '@config/config.type';
import type { IJwtPayload } from '@app/types';

/**
 * Internal token resolution (referralai_api_contract — /internal/validate-token).
 * Resolves an API key or an OAuth2 JWT to the internal claim set consumed by the
 * gateway and the auth guard. JWT verification mirrors JwtStrategy (same JWKS config).
 */
export interface ValidateTokenResult {
    tenant_id: string;
    scopes: string[];
    source: 'api_key' | 'oauth2_jwt';
    key_type: string | null;
    key_id: string | null;
    user_id: string;
}

@Injectable()
export class TokenResolverService {
    private readonly jwks: JwksClient;

    constructor(
        private readonly apiKeyService: ApiKeyService,
        private readonly configService: ConfigService<AllConfigType>,
        private readonly logger: AppLoggerService
    ) {
        this.logger.setContext(TokenResolverService.name);
        this.jwks = new JwksClient({
            jwksUri: this.configService.getOrThrow('auth.jwksUri', { infer: true }),
            cache: true,
            rateLimit: true
        });
    }

    async resolve(apiKey?: string, bearerToken?: string): Promise<ValidateTokenResult> {
        if (apiKey) {
            return this.resolveApiKey(apiKey);
        }
        if (bearerToken) {
            return this.resolveJwt(bearerToken);
        }
        throw new UnauthorizedException('No API key or bearer token provided');
    }

    private async resolveApiKey(rawKey: string): Promise<ValidateTokenResult> {
        const apiKey = await this.apiKeyService.validateKey(rawKey);
        if (!apiKey) {
            throw new UnauthorizedException('Invalid API key');
        }
        return {
            tenant_id: apiKey.tenantId,
            scopes: Array.isArray(apiKey.scopes) ? (apiKey.scopes as string[]) : [],
            source: 'api_key',
            key_type: apiKey.keyType,
            key_id: apiKey.id,
            user_id: apiKey.createdBy
        };
    }

    private async resolveJwt(token: string): Promise<ValidateTokenResult> {
        const issuer = this.configService.getOrThrow('auth.issuer', { infer: true });
        const audience = this.configService.getOrThrow('auth.audience', { infer: true });
        const algorithms = this.configService.getOrThrow('auth.algorithms', { infer: true });
        const clockTolerance = this.configService.getOrThrow('auth.clockTolerance', { infer: true });
        const tenantClaimPath = this.configService.get('auth.tenantClaimPath', { infer: true }) || 'tenantId';

        const payload = await this.verify(token, {
            issuer,
            audience,
            algorithms: algorithms as jwt.Algorithm[],
            clockTolerance
        });

        const tenantId = this.extractClaim(payload, tenantClaimPath);
        if (!tenantId) {
            throw new UnauthorizedException('Tenant ID not found in token claims');
        }

        return {
            tenant_id: tenantId,
            scopes: payload.scp ?? [],
            source: 'oauth2_jwt',
            key_type: null,
            key_id: null,
            user_id: payload.ext?.user_id ?? payload.sub
        };
    }

    private verify(token: string, options: jwt.VerifyOptions): Promise<IJwtPayload> {
        const getKey: jwt.GetPublicKeyOrSecret = (header, callback) => {
            this.jwks
                .getSigningKey(header.kid)
                .then((key) => callback(null, key.getPublicKey()))
                .catch((error) => callback(error as Error));
        };

        return new Promise((resolve, reject) => {
            jwt.verify(token, getKey, options, (error, decoded) => {
                if (error || !decoded || typeof decoded === 'string') {
                    reject(new UnauthorizedException('Invalid or expired token'));
                    return;
                }
                resolve(decoded as IJwtPayload);
            });
        });
    }

    private extractClaim(payload: IJwtPayload, path: string): string | undefined {
        let value: unknown = payload;
        for (const key of path.split('.')) {
            value = (value as Record<string, unknown>)?.[key];
            if (value === undefined) {
                return undefined;
            }
        }
        return typeof value === 'string' ? value : undefined;
    }
}
