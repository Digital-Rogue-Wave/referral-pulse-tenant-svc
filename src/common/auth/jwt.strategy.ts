import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

import { passportJwtSecret } from 'jwks-rsa';
import { Strategy, ExtractJwt } from 'passport-jwt';

import { IAuthenticatedUser, IJwtPayload } from '@app/types';

import type { AllConfigType } from '@config/config.type';

/**
 * JWT Strategy using JWKS (JSON Web Key Set) for token validation.
 * Validates OpenID Connect tokens from auth providers (Auth0, Ory Kratos, etc.)
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    private readonly tenantClaimPath: string;

    constructor(private readonly configService: ConfigService<AllConfigType>) {
        const jwksUri = configService.getOrThrow('auth.jwksUri', { infer: true });
        const issuer = configService.getOrThrow('auth.issuer', { infer: true });
        const audience = configService.getOrThrow('auth.audience', { infer: true });
        const algorithms = configService.getOrThrow('auth.algorithms', {
            infer: true
        });
        const clockTolerance = configService.getOrThrow('auth.clockTolerance', {
            infer: true
        });
        const cacheEnabled = configService.getOrThrow('auth.cacheEnabled', {
            infer: true
        });
        const cacheTtl = configService.getOrThrow('auth.cacheTtl', { infer: true });

        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKeyProvider: passportJwtSecret({
                cache: cacheEnabled,
                rateLimit: true,
                jwksRequestsPerMinute: 10,
                jwksUri,
                ...(cacheEnabled && { cacheMaxAge: cacheTtl * 1000 })
            }),
            issuer,
            audience,
            algorithms: algorithms as ('RS256' | 'RS384' | 'RS512' | 'ES256' | 'ES384' | 'ES512')[],
            jsonWebTokenOptions: {
                clockTolerance
            }
        });

        this.tenantClaimPath = configService.get('auth.tenantClaimPath', { infer: true }) || 'tenantId';
    }

    /**
     * Validate JWT payload and extract user information.
     * This is called after the token signature is verified.
     *
     * Handles two token types:
     * - User tokens (authorization_code): has sub = user ID, ext.tenant_id, email
     * - Service tokens (client_credentials): has sub = client ID, client_id field
     */
    async validate(payload: IJwtPayload): Promise<IAuthenticatedUser> {
        if (this.isServiceToken(payload)) {
            return this.buildServiceUser(payload);
        }

        return this.buildHumanUser(payload);
    }

    private isServiceToken(payload: IJwtPayload): boolean {
        return payload.grant_type === 'client_credentials' || (!!payload.client_id && !payload.email && !payload.ext?.user_id);
    }

    private buildServiceUser(payload: IJwtPayload): IAuthenticatedUser {
        const tenantId = this.extractNestedClaim(payload, this.tenantClaimPath);

        return {
            userId: payload.sub,
            tenantId: tenantId ?? '',
            clientId: payload.client_id,
            isServiceToken: true,
            scopes: payload.scp,
            metadata: this.extractMetadata(payload)
        };
    }

    private buildHumanUser(payload: IJwtPayload): IAuthenticatedUser {
        // Tenant is normally required, but it is enforced in JwtAuthGuard (which has route context) so
        // that tenant-optional onboarding routes (@AllowNoTenant, e.g. invitation accept) can pass.
        const tenantId = this.extractNestedClaim(payload, this.tenantClaimPath);
        const userId = payload.ext?.user_id ?? payload.sub;

        return {
            userId,
            tenantId: tenantId ?? '',
            email: payload.email,
            roles: payload.ext?.roles,
            scopes: payload.scp,
            metadata: this.extractMetadata(payload)
        };
    }

    /**
     * Extract a claim from JWT payload using a dot-separated path.
     * Supports nested paths like "ext.tenant_id"
     */
    private extractNestedClaim(payload: IJwtPayload, path: string): string | undefined {
        const parts = path.split('.');
        let value: unknown = payload;

        for (const key of parts) {
            value = (value as Record<string, unknown>)?.[key];
            if (value === undefined) {
                return undefined;
            }
        }

        return typeof value === 'string' ? value : undefined;
    }

    /**
     * Extract additional metadata from JWT claims.
     * Filters out standard JWT claims.
     */
    private extractMetadata(payload: IJwtPayload): Record<string, unknown> {
        const standardClaims = ['sub', 'iss', 'aud', 'exp', 'iat', 'nbf', 'jti', 'azp', 'client_id', 'scp', 'grant_type', 'ext'];
        const metadata: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(payload)) {
            if (!standardClaims.includes(key)) {
                metadata[key] = value;
            }
        }

        return metadata;
    }
}
