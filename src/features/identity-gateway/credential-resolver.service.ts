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
import { BREAK_GLASS_PERMISSIONS, BreakGlassService } from '@app/features/break-glass/break-glass.service';
import { ApiKeyType } from '@domains/api-key';
import { TenantStatus } from '@domains/tenant/tenant.types';

import type { AllConfigType } from '@config/config.type';

import { InternalTokenService, IssuedToken } from './internal-token.service';

/** API-key exchanges are re-resolved at least this often so a revocation lands within a minute. */
const API_KEY_EXCHANGE_TTL_SECONDS = 60;
/** A break-glass token outlives its request by a minute at most, so reads stay on the gateway, where they are audited. */
const BREAK_GLASS_TOKEN_TTL_SECONDS = 60;

export interface ResolvedCredential extends IssuedToken {
    claims: IInternalTokenClaims;
}

/** What the gateway forwards about the request being authorized (Traefik forwardAuth `X-Forwarded-*`). */
export interface ExchangeContext {
    breakGlassTenantId?: string;
    method?: string;
    uri?: string;
}

/**
 * Turns whatever credential the caller presented into the platform's internal JWT
 * (Architecture §13.1, API Contract §2):
 *
 * - `rai_live_` / `rai_pub_` API key → `{ source: 'api_key', key_type, key_id, tenant_id }`, no `perms`
 *   (keys are gated to ingestion/SDK and are never Keto subjects).
 * - Ory Hydra user token (dashboard) → `{ source: 'dashboard', user_id, tenant_id, perms }`, where `perms`
 *   is resolved from Keto now. An identity with no membership yet (an invitee) gets a token without a
 *   tenant, usable only on tenant-optional routes.
 *
 * Closed tenants are refused here, once, instead of in every service. A removed member is not refused: their
 * token simply carries no tenant, like an invitee's, and their cached exchanges are dropped on removal (`forgetUser`).
 * User-token exchanges are cached by credential hash until shortly before the minted internal JWT expires (at most
 * `INTERNAL_JWT_TTL_SECONDS`), and indexed per user so a removal or role change takes effect on the next request.
 */
/** The cached exchange keys of one user (`authn:exchange:*`), so they can be dropped together. */
function userExchangesKey(userId: string): string {
    return `authn:exchange:user:${userId}`;
}

/** The cached exchange keys that carry one tenant, so a deleted tenant's can be dropped together. */
function tenantExchangesKey(tenantId: string): string {
    return `authn:exchange:tenant:${tenantId}`;
}

@Injectable()
export class CredentialResolverService {
    private readonly hydraJwks: JwksClient;
    private readonly hydra: { issuer: string; audience: string; algorithms: jwt.Algorithm[]; clockTolerance: number };
    private readonly platformConsoleClientId: string;

    constructor(
        configService: ConfigService<AllConfigType>,
        private readonly prisma: DatabaseService,
        private readonly redis: RedisService,
        private readonly apiKeys: ApiKeyService,
        private readonly authorization: AuthorizationService,
        private readonly internalTokens: InternalTokenService,
        private readonly breakGlass: BreakGlassService
    ) {
        const auth = configService.getOrThrow('auth', { infer: true });
        this.platformConsoleClientId = auth.platformConsoleClientId;
        this.hydraJwks = new JwksClient({ jwksUri: auth.jwksUri, cache: true, rateLimit: true });
        this.hydra = {
            issuer: auth.issuer,
            audience: auth.audience,
            algorithms: auth.algorithms as jwt.Algorithm[],
            clockTolerance: auth.clockTolerance
        };
    }

    async resolve(credential: string, context: ExchangeContext = {}): Promise<ResolvedCredential> {
        // API keys are resolved through their own cache, which revocation and rotation clear immediately.
        if (this.isApiKey(credential)) {
            return this.resolveApiKey(credential);
        }
        // Never cached: each request must see whether its break-glass window is still open, and each one is audited.
        if (this.isPlatformConsoleToken(credential)) {
            return this.resolvePlatformToken(credential, context);
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
            if (resolved.claims.user_id) {
                await this.redis.addToSet(userExchangesKey(resolved.claims.user_id), cacheKey, ttl);
            }
            if (resolved.claims.tenant_id) {
                await this.redis.addToSet(tenantExchangesKey(resolved.claims.tenant_id), cacheKey, ttl);
            }
        }
        return resolved;
    }

    /**
     * Drops every cached exchange of `userId`, so their next request is resolved again from the database and Keto.
     * Called when a member is removed or their role changes (US1.2.4 F1).
     */
    async forgetUser(userId: string): Promise<number> {
        return this.dropExchanges(userExchangesKey(userId));
    }

    /** Drops every cached exchange that carries `tenantId`: a deleted tenant authenticates nobody, cached or not. */
    async forgetTenant(tenantId: string): Promise<number> {
        return this.dropExchanges(tenantExchangesKey(tenantId));
    }

    private async dropExchanges(indexKey: string): Promise<number> {
        const keys = await this.redis.takeSet(indexKey);
        await Promise.all(keys.map((key) => this.redis.del(key, false)));
        return keys.length;
    }

    /** Routing only: the token is fully verified, with the platform audience, before anything is trusted. */
    private isPlatformConsoleToken(credential: string): boolean {
        const claims = jwt.decode(credential) as { client_id?: string } | null;
        return Boolean(claims?.client_id) && claims?.client_id === this.platformConsoleClientId;
    }

    /**
     * ReferralAI staff (Product Spec R-ACT-02, E1 D17). A platform-console token never resolves to a tenant membership:
     * it becomes a platform token with no tenant, usable only on `@PlatformAdmin` routes. With `X-Break-Glass-Tenant`
     * and an open window on that tenant, it becomes instead a read-only token for that tenant, valid one minute at most
     * (never past the window), and the request is written to the tenant's audit log.
     */
    private async resolvePlatformToken(token: string, context: ExchangeContext): Promise<ResolvedCredential> {
        const payload = await this.verifyHydraToken(token, this.platformConsoleClientId);
        if (payload.client_id !== this.platformConsoleClientId) {
            throw this.unauthenticated('expired_token', 'Invalid or expired token');
        }
        const identityId = payload.sub;
        const base: IInternalTokenClaims = {
            tenant_id: null,
            user_id: null,
            identity_id: identityId,
            email: payload.email ?? null,
            source: 'platform',
            key_type: null,
            key_id: null,
            perms: []
        };
        if (!context.breakGlassTenantId) {
            return { ...this.internalTokens.issue(`staff:${identityId}`, base, new Date(payload.exp * 1000)), claims: base };
        }

        const grant = await this.breakGlass.activeGrant(identityId, context.breakGlassTenantId);
        if (!grant) {
            throw new BaseException('authorization_error', 'No open break-glass window on this tenant', HttpStatus.FORBIDDEN);
        }
        await this.assertTenantOpen(grant.tenantId);
        await this.breakGlass.recordRead(grant, context);

        const claims: IInternalTokenClaims = { ...base, tenant_id: grant.tenantId, source: 'break_glass', perms: [...BREAK_GLASS_PERMISSIONS] };
        const notAfter = new Date(
            Math.min(payload.exp * 1000, new Date(grant.expiresAt).getTime(), Date.now() + BREAK_GLASS_TOKEN_TTL_SECONDS * 1000)
        );
        return { ...this.internalTokens.issue(`staff:${identityId}`, claims, notAfter), claims };
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
            // A disabled member (E1 D5) resolves like an identity with no membership: no tenant, no perms.
            where: { kratosIdentityId: identityId, deletedAt: null, disabledAt: null },
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
        if (!tenant || tenant.deletedAt || tenant.status === TenantStatus.CLOSED) {
            throw this.unauthenticated('authentication_error', 'This account is closed');
        }
    }

    private async verifyHydraToken(token: string, audience: string = this.hydra.audience): Promise<IJwtPayload> {
        try {
            const kid = jwt.decode(token, { complete: true })?.header.kid;
            const signingKey = await this.hydraJwks.getSigningKey(kid);
            const decoded = jwt.verify(token, signingKey.getPublicKey(), {
                issuer: this.hydra.issuer,
                audience,
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
