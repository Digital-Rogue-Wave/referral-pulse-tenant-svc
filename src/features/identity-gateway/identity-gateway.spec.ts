import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import { createPublicKey, generateKeyPairSync } from 'crypto';
import * as jwt from 'jsonwebtoken';

import type { IInternalTokenClaims } from '@app/types';

import { AuthorizationService } from '@common/auth/authz/authorization.service';
import { BaseException } from '@common/exceptions/base.exceptions';
import { RedisService } from '@common/redis/redis.service';
import { DatabaseService } from '@app/database/database.service';
import { ApiKeyService } from '@app/features/api-key/api-key.service';
import { ApiKeyType } from '@domains/api-key';
import { TenantStatus } from '@domains/tenant/tenant.types';

import { CredentialResolverService } from './credential-resolver.service';
import { IdentityGatewayController } from './identity-gateway.controller';
import { InternalTokenService } from './internal-token.service';

const ecKey = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
});
const GATEWAY_SECRET = 'g'.repeat(40);

const configWith = (overrides: Record<string, unknown> = {}): ConfigService =>
    ({
        getOrThrow: (key: string) =>
            ({
                tokenIssuer: { privateKeyPem: ecKey.privateKey, ttlSeconds: 300, gatewaySecret: GATEWAY_SECRET },
                'tokenIssuer.gatewaySecret': GATEWAY_SECRET,
                auth: {
                    internalIssuer: 'referralai-tenant-svc',
                    internalAudience: 'referralai-internal',
                    jwksUri: 'http://hydra.test/.well-known/jwks.json',
                    issuer: 'http://hydra.test/',
                    audience: 'dashboard',
                    algorithms: ['RS256', 'ES256'],
                    clockTolerance: 0
                },
                ...overrides
            })[key]
    }) as unknown as ConfigService;

const verify = (token: string): jwt.JwtPayload & IInternalTokenClaims =>
    jwt.verify(token, createPublicKey(ecKey.publicKey), {
        issuer: 'referralai-tenant-svc',
        audience: 'referralai-internal',
        algorithms: ['ES256']
    }) as jwt.JwtPayload & IInternalTokenClaims;

const claims = (overrides: Partial<IInternalTokenClaims> = {}): IInternalTokenClaims => ({
    tenant_id: 't1',
    user_id: 'u1',
    identity_id: 'kratos-1',
    email: null,
    source: 'dashboard',
    key_type: null,
    key_id: null,
    perms: ['tenants:read'],
    ...overrides
});

describe('InternalTokenService', () => {
    const tokens = new InternalTokenService(configWith());

    it('signs ES256 tokens that verify against the published JWKS key', () => {
        const { token } = tokens.issue('user:u1', claims());
        const [jwk] = tokens.jwks().keys;
        const payload = jwt.verify(token, createPublicKey({ key: jwk as unknown as import('crypto').JsonWebKey, format: 'jwk' }), {
            algorithms: ['ES256']
        }) as jwt.JwtPayload;

        expect(payload.sub).toBe('user:u1');
        expect(payload.perms).toEqual(['tenants:read']);
        expect(jwt.decode(token, { complete: true })!.header.kid).toBe(jwk!.kid);
    });

    it('uses a stable RFC 7638 thumbprint as the key id', () => {
        expect(new InternalTokenService(configWith()).jwks().keys[0]!.kid).toBe(tokens.jwks().keys[0]!.kid);
    });

    it('never outlives the credential it was exchanged for, nor the configured TTL', () => {
        const soon = new Date(Date.now() + 20_000);
        const { token, expiresAt } = tokens.issue('user:u1', claims(), soon);
        const payload = verify(token);
        expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(20);
        expect(expiresAt.getTime()).toBeLessThanOrEqual(soon.getTime());

        const later = verify(tokens.issue('user:u1', claims(), new Date(Date.now() + 86_400_000)).token);
        expect(later.exp! - later.iat!).toBe(300);
    });

    it('refuses a non-P-256 signing key at start-up', () => {
        const rsa = generateKeyPairSync('rsa', {
            modulusLength: 2048,
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'pem' }
        });
        expect(
            () =>
                new InternalTokenService(
                    configWith({ tokenIssuer: { privateKeyPem: rsa.privateKey, ttlSeconds: 300, gatewaySecret: GATEWAY_SECRET } })
                )
        ).toThrow(/P-256/);
    });
});

describe('CredentialResolverService', () => {
    let prisma: MockProxy<DatabaseService>;
    let redis: MockProxy<RedisService>;
    let apiKeys: MockProxy<ApiKeyService>;
    let authorization: MockProxy<AuthorizationService>;
    let resolver: CredentialResolverService;
    let findUser: jest.Mock;
    let findTenant: jest.Mock;

    beforeEach(() => {
        prisma = mock<DatabaseService>();
        redis = mock<RedisService>();
        apiKeys = mock<ApiKeyService>();
        authorization = mock<AuthorizationService>();
        findUser = jest.fn();
        findTenant = jest.fn().mockResolvedValue({ status: TenantStatus.ACTIVE, deletedAt: null });
        (prisma as unknown as { user: unknown }).user = { findFirst: findUser };
        (prisma as unknown as { tenant: unknown }).tenant = { findUnique: findTenant };
        redis.get.mockResolvedValue(undefined);
        resolver = new CredentialResolverService(configWith(), prisma, redis, apiKeys, authorization, new InternalTokenService(configWith()));
    });

    const stubHydra = (payload: Record<string, unknown>): void => {
        jest.spyOn(resolver as unknown as { verifyHydraToken: () => Promise<unknown> }, 'verifyHydraToken').mockResolvedValue({
            exp: Math.floor(Date.now() / 1000) + 900,
            ...payload
        });
    };

    describe('given an API key', () => {
        it('then it mints an api_key token with the key type and no permissions', async () => {
            apiKeys.validateKey.mockResolvedValue({ id: 'key-1', tenantId: 't1', keyType: ApiKeyType.PUBLISHABLE } as never);

            const resolved = await resolver.resolve('rai_pub_abc');
            const payload = verify(resolved.token);

            expect(payload).toMatchObject({ source: 'api_key', tenant_id: 't1', key_type: 'publishable', key_id: 'key-1', perms: [], user_id: null });
            expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(60);
        });

        it('then an unknown key is unauthenticated', async () => {
            apiKeys.validateKey.mockResolvedValue(null);
            const error = await resolver.resolve('rai_live_nope').catch((e: BaseException) => e);
            expect((error as BaseException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        });

        it('then a key of a closed tenant is unauthenticated', async () => {
            apiKeys.validateKey.mockResolvedValue({ id: 'key-1', tenantId: 't1', keyType: ApiKeyType.SECRET } as never);
            findTenant.mockResolvedValue({ status: TenantStatus.DELETED, deletedAt: new Date() });
            const error = await resolver.resolve('rai_live_abc').catch((e: BaseException) => e);
            expect((error as BaseException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        });
    });

    describe('given a dashboard (Hydra) token', () => {
        it('then it resolves the member and embeds the Keto permission snapshot', async () => {
            stubHydra({ sub: 'kratos-1' });
            findUser.mockResolvedValue({ id: 'u1', tenantId: 't1', email: 'ada@acme.io' });
            authorization.resolvePermissions.mockResolvedValue(['tenants:read', 'campaigns:write']);

            const payload = verify((await resolver.resolve('hydra.jwt.token')).token);

            expect(findUser).toHaveBeenCalledWith(expect.objectContaining({ where: { kratosIdentityId: 'kratos-1', deletedAt: null } }));
            expect(payload).toMatchObject({
                source: 'dashboard',
                user_id: 'u1',
                tenant_id: 't1',
                identity_id: 'kratos-1',
                perms: ['tenants:read', 'campaigns:write']
            });
            expect(payload.sub).toBe('user:u1');
        });

        it('then an identity with no membership gets a tenant-less token (onboarding / invitation acceptance)', async () => {
            stubHydra({ sub: 'kratos-new' });
            findUser.mockResolvedValue(null);

            const payload = verify((await resolver.resolve('hydra.jwt.token')).token);

            expect(payload).toMatchObject({ tenant_id: null, user_id: null, identity_id: 'kratos-new', perms: [] });
            expect(authorization.resolvePermissions).not.toHaveBeenCalled();
        });
    });

    it('serves a repeated exchange from cache without re-resolving', async () => {
        const cached = { token: 't', expiresAt: new Date(Date.now() + 120_000).toISOString(), claims: claims() };
        redis.get.mockResolvedValue(cached as never);

        const resolved = await resolver.resolve('rai_live_abc');

        expect(resolved.token).toBe('t');
        expect(resolved.expiresAt).toBeInstanceOf(Date);
        expect(apiKeys.validateKey).not.toHaveBeenCalled();
    });
});

describe('IdentityGatewayController', () => {
    const credentials = mock<CredentialResolverService>();
    const controller = new IdentityGatewayController(configWith(), credentials, new InternalTokenService(configWith()));
    const response = { setHeader: jest.fn() };

    it('refuses callers that are not the gateway', async () => {
        for (const secret of [undefined, 'wrong', `${GATEWAY_SECRET}x`]) {
            const error = await controller
                .validateToken({ 'x-gateway-secret': secret, 'x-api-key': 'rai_live_abc' }, response as never)
                .catch((e: BaseException) => e);
            expect((error as BaseException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        }
        expect(credentials.resolve).not.toHaveBeenCalled();
    });

    it('returns the internal JWT in the Authorization header for Traefik forwardAuth', async () => {
        credentials.resolve.mockResolvedValue({ token: 'internal.jwt', expiresAt: new Date(), claims: claims() });

        const body = await controller.validateToken({ 'x-gateway-secret': GATEWAY_SECRET, authorization: 'Bearer hydra.jwt' }, response as never);

        expect(credentials.resolve).toHaveBeenCalledWith('hydra.jwt');
        expect(response.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer internal.jwt');
        expect(body.token).toBe('internal.jwt');
    });

    it('rejects a gateway call that carries no credential', async () => {
        const error = await controller.validateToken({ 'x-gateway-secret': GATEWAY_SECRET }, response as never).catch((e: BaseException) => e);
        expect((error as BaseException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    });
});
