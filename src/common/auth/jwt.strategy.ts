import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import type { AllConfigType } from '@app/config/config.type';
import { IAuthenticatedUser, IJwtPayload } from '@app/types';

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
        const algorithms = configService.getOrThrow('auth.algorithms', { infer: true });
        const clockTolerance = configService.getOrThrow('auth.clockTolerance', { infer: true });
        const cacheEnabled = configService.getOrThrow('auth.cacheEnabled', { infer: true });
        const cacheTtl = configService.getOrThrow('auth.cacheTtl', { infer: true });

        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKeyProvider: passportJwtSecret({
                cache: cacheEnabled,
                rateLimit: true,
                jwksRequestsPerMinute: 10,
                jwksUri,
                ...(cacheEnabled && { cacheMaxAge: cacheTtl * 1000 }),
            }),
            issuer,
            audience,
            algorithms,
            clockTolerance,
        });

        this.tenantClaimPath = configService.get('auth.tenantClaimPath', { infer: true }) || 'tenantId';
    }

    /**
     * Validate JWT payload and extract user information.
     * This is called after the token signature is verified.
     */
    async validate(payload: IJwtPayload): Promise<IAuthenticatedUser> {
        const userId = payload.sub;
        const tenantId = this.extractTenantId(payload);

        if (!tenantId) {
            throw new Error('Tenant ID not found in token claims');
        }

        return {
            userId,
            tenantId,
            email: payload.email as string | undefined,
            roles: payload.roles as string[] | undefined,
            permissions: payload.permissions as string[] | undefined,
            metadata: this.extractMetadata(payload),
        };
    }

    /**
     * Extract tenant ID from JWT claims using configured path.
     * Supports nested paths like "organization.id" or "tenantId"
     */
    private extractTenantId(payload: IJwtPayload): string | undefined {
        const path = this.tenantClaimPath.split('.');
        let value: any = payload;

        for (const key of path) {
            value = value?.[key];
            if (value === undefined) return undefined;
        }

        return typeof value === 'string' ? value : undefined;
    }

    /**
     * Extract additional metadata from JWT claims.
     * Filters out standard JWT claims.
     */
    private extractMetadata(payload: IJwtPayload): Record<string, unknown> {
        const standardClaims = ['sub', 'iss', 'aud', 'exp', 'iat', 'nbf', 'jti', 'azp'];
        const metadata: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(payload)) {
            if (!standardClaims.includes(key)) {
                metadata[key] = value;
            }
        }

        return metadata;
    }
}
