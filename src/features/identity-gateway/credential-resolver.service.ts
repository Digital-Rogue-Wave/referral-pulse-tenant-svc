import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createHash } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';

import type { IInternalTokenClaims, IJwtPayload } from '@app/types';

import { AuthorizationService } from '@common/auth/authz/authorization.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { RedisService } from '@common/redis/redis.service';
import { DatabaseService } from '@app/database/database.service';
import { ApiKeyService } from '@app/features/api-key/api-key.service';
import { ApiKeyType } from '@domains/api-key';
import { TenantStatus } from '@domains/tenant/tenant.types';

import type { AllConfigType } from '@config/config.type';

import { InternalTokenService, IssuedToken } from './internal-token.service';

/** API-key exchanges are re-resolved at least this often so a revocation lands within a minute. */
const API_KEY_EXCHANGE_TTL_SECONDS = 60;

export interface ResolvedCredential extends IssuedToken {
    claims: IInternalTokenClaims;
}

/**
 * Turns whatever credential the caller presented into the platform's internal JWT
 * (Architecture §13.1, API Contract v1.3 §2):
 *
 * - `rai_live_` / `rai_pub_` API key → `{ source: 'api_key', key_type, key_id, tenant_id }`, no `perms`
 *   (keys are gated to ingestion/SDK and are never Keto subjects).
 * - Ory Hydra user token (dashboard) → `{ source: 'dashboard', user_id, tenant_id, perms }`, where `perms`
 *   is resolved from Keto now. An identity with no membership yet (an invitee) gets a token without a
 *   tenant, usable only on tenant-optional routes.
 *
 * Closed tenants and disabled users are refused here, once, instead of in every service.
 * User-token exchanges are cached by credential hash until shortly before the minted token would expire.
 */
@Injectable()
export class CredentialResolverService {
    private readonly hydraJwks: JwksClient;
    private readonly hydra: { issuer: string; audience: string; algorithms: jwt.Algorithm[]; clockTolerance: number };

    constructor(
        configService: ConfigService<AllConfigType>,
        private readonly prisma: DatabaseService,
        private readonly redis: RedisService,
        private readonly apiKeys: ApiKeyService,
        private readonly authorization: AuthorizationService,
        private readonly internalTokens: InternalTokenService
    ) {
        const auth = configService.getOrThrow('auth', { infer: true });
        this.hydraJwks = new JwksClient({ jwksUri: auth.jwksUri, cache: true, rateLimit: true });
        this.hydra = {
            issuer: auth.issuer,
            audience: auth.audience,
            algorithms: auth.algorithms as jwt.Algorithm[],
            clockTolerance: auth.clockTolerance
        };
    }

    async resolve(credential: string): Promise<ResolvedCredential> {
        // API keys are resolved through their own cache, which revocation and rotation clear immediately.
        if (this.isApiKey(credential)) {
            return this.resolveApiKey(credential);
        }

        const cacheKey = `authn:exchange:${createHash('sha256').update(credential).digest('hex')}`;
        const cached = await this.redis.get<ResolvedCredential>(cacheKey, { tenantScoped: false });
        if (cached && new Date(cached.expiresAt).getTime() - Date.now() > 30_000) {
            return { ...cached, expiresAt: new Date(cached.expiresAt) };
        }

        const resolved = await this.resolveUserToken(credential);
        const ttl = Math.floor((resolved.expiresAt.getTime() - Date.now()) / 1000) - 30;
        if (ttl > 0) {
            await this.redis.set(cacheKey, resolved, { tenantScoped: false, ttl });
        }
        return resolved;
    }

    private isApiKey(credential: string): boolean {
        return credential.startsWith('rai_live_') || credential.startsWith('rai_pub_');
    }

    private async resolveApiKey(rawKey: string): Promise<ResolvedCredential> {
        const apiKey = await this.apiKeys.validateKey(rawKey);
        if (!apiKey) {
            throw this.unauthenticated('invalid_api_key', 'Invalid API key');
        }
        await this.assertTenantOpen(apiKey.tenantId);

        const claims: IInternalTokenClaims = {
            tenant_id: apiKey.tenantId,
            user_id: null,
            identity_id: null,
            email: null,
            source: 'api_key',
            key_type: apiKey.keyType === ApiKeyType.PUBLISHABLE ? 'publishable' : 'secret',
            key_id: apiKey.id,
            perms: []
        };
        const notAfter = new Date(Date.now() + API_KEY_EXCHANGE_TTL_SECONDS * 1000);
        return { ...this.internalTokens.issue(`api_key:${apiKey.id}`, claims, notAfter), claims };
    }

    private async resolveUserToken(token: string): Promise<ResolvedCredential> {
        const payload = await this.verifyHydraToken(token);
        const identityId = payload.sub;
        const user = await this.prisma.user.findFirst({
            where: { kratosIdentityId: identityId, deletedAt: null },
            select: { id: true, tenantId: true, email: true }
        });

        const claims: IInternalTokenClaims = {
            tenant_id: user?.tenantId ?? null,
            user_id: user?.id ?? null,
            identity_id: identityId,
            email: user?.email ?? payload.email ?? null,
            source: 'dashboard',
            key_type: null,
            key_id: null,
            perms: []
        };
        if (user) {
            await this.assertTenantOpen(user.tenantId);
            claims.perms = await this.authorization.resolvePermissions(user.id, user.tenantId);
        }

        const subject = user ? `user:${user.id}` : `identity:${identityId}`;
        return { ...this.internalTokens.issue(subject, claims, new Date(payload.exp * 1000)), claims };
    }

    /** A deleted/closed tenant authenticates nobody. Suspension and locks are enforced per route by the tenant guards. */
    private async assertTenantOpen(tenantId: string): Promise<void> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true, deletedAt: true } });
        if (!tenant || tenant.deletedAt || tenant.status === TenantStatus.DELETED) {
            throw this.unauthenticated('authentication_error', 'This account is closed');
        }
    }

    private async verifyHydraToken(token: string): Promise<IJwtPayload> {
        try {
            const kid = jwt.decode(token, { complete: true })?.header.kid;
            const signingKey = await this.hydraJwks.getSigningKey(kid);
            const decoded = jwt.verify(token, signingKey.getPublicKey(), {
                issuer: this.hydra.issuer,
                audience: this.hydra.audience,
                algorithms: this.hydra.algorithms,
                clockTolerance: this.hydra.clockTolerance
            });
            if (typeof decoded === 'string') {
                throw new Error('unexpected string payload');
            }
            return decoded as IJwtPayload;
        } catch {
            throw this.unauthenticated('expired_token', 'Invalid or expired token');
        }
    }

    private unauthenticated(code: 'invalid_api_key' | 'expired_token' | 'authentication_error', message: string): BaseException {
        return new BaseException(code, message, HttpStatus.UNAUTHORIZED);
    }
}
