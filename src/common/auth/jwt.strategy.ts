import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { passportJwtSecret } from 'jwks-rsa';
import { Strategy, ExtractJwt } from 'passport-jwt';

import type { IAuthenticatedUser, IInternalTokenClaims, IJwtPayload } from '@app/types';

import type { AllConfigType } from '@config/config.type';

type KeyProvider = (request: Request, rawJwtToken: string, done: (err: unknown, secretOrKey?: string | Buffer) => void) => void;
type InternalPayload = IJwtPayload & IInternalTokenClaims;

/**
 * Verifies the two token kinds a service may receive (Architecture §13.1, API Contract v1.3 §2):
 *
 * 1. The internal JWT minted by tenant-service's /internal/validate-token — every dashboard and API-key
 *    request, after the gateway exchanged the credential. Carries tenant_id, user_id, source, key_type, perms.
 * 2. An Ory Hydra client-credentials token — service-to-service calls on the mesh.
 *
 * A Hydra token for a *human* is rejected: dashboard traffic must come through the gateway, which is the
 * only place `perms` is resolved.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    private readonly hydraIssuer: string;

    constructor(configService: ConfigService<AllConfigType>) {
        const auth = configService.getOrThrow('auth', { infer: true });
        const keyProviderFor = (jwksUri: string): KeyProvider =>
            passportJwtSecret({
                cache: auth.cacheEnabled,
                rateLimit: true,
                jwksRequestsPerMinute: 10,
                jwksUri,
                ...(auth.cacheEnabled && { cacheMaxAge: auth.cacheTtl * 1000 })
            }) as KeyProvider;
        const internalKeys = keyProviderFor(auth.internalJwksUri);
        const hydraKeys = keyProviderFor(auth.jwksUri);

        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKeyProvider: (request: Request, rawJwtToken: string, done: (err: unknown, key?: string | Buffer) => void) => {
                const decoded = jwt.decode(rawJwtToken) as { iss?: string } | null;
                const provider = decoded?.iss === auth.internalIssuer ? internalKeys : hydraKeys;
                provider(request, rawJwtToken, done);
            },
            issuer: [auth.internalIssuer, auth.issuer],
            audience: [auth.internalAudience, auth.audience],
            algorithms: auth.algorithms as jwt.Algorithm[],
            jsonWebTokenOptions: { clockTolerance: auth.clockTolerance }
        });

        this.hydraIssuer = auth.issuer;
    }

    validate(payload: IJwtPayload): IAuthenticatedUser {
        if (payload.iss === this.hydraIssuer) {
            return this.buildServicePrincipal(payload);
        }
        return this.buildInternalPrincipal(payload as InternalPayload);
    }

    private buildServicePrincipal(payload: IJwtPayload): IAuthenticatedUser {
        if (payload.grant_type !== 'client_credentials' && !(payload.client_id && payload.sub === payload.client_id)) {
            throw new UnauthorizedException('User tokens must be exchanged at the gateway');
        }
        return {
            userId: '',
            tenantId: '',
            source: 'client_credentials',
            isServiceToken: true,
            clientId: payload.client_id ?? payload.sub
        };
    }

    private buildInternalPrincipal(payload: InternalPayload): IAuthenticatedUser {
        return {
            userId: payload.user_id ?? '',
            tenantId: payload.tenant_id ?? '',
            identityId: payload.identity_id ?? undefined,
            email: payload.email ?? undefined,
            source: payload.source,
            keyType: payload.key_type,
            keyId: payload.key_id,
            perms: payload.perms ?? []
        };
    }
}
