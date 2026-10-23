import { HttpStatus } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import { createPublicKey, generateKeyPairSync } from 'crypto';
import * as jwt from 'jsonwebtoken';

import type { IAuthenticatedUser, IInternalTokenClaims } from '@app/types';

import { AuthorizationService } from '@common/auth/authz/authorization.service';
import { ServiceCapability } from '@common/auth/authz/keto-tuples';
import { BaseException } from '@common/exceptions/base.exceptions';
import { RedisService } from '@common/redis/redis.service';
import { DatabaseService } from '@app/database/database.service';
import { ApiKeyService } from '@app/features/api-key/api-key.service';
import { ApiKeyType } from '@domains/api-key';
import { TenantStatus } from '@domains/tenant/tenant.types';

import { CredentialResolverService } from './credential-resolver.service';
import { IdentityGatewayController } from './identity-gateway.controller';
import { InternalTokenService } from './internal-token.service';
import { TokenExchangeCallerGuard, type TokenExchangeCaller } from './token-exchange-caller.guard';

const ecKey = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
});
const GATEWAY_SECRET = 'g'.repeat(40);

const loggerStub = () => ({ setContext: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() });

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
            findTenant.mockResolvedValue({ status: TenantStatus.CLOSED, deletedAt: new Date() });
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

    it('serves a repeated user-token exchange from cache without re-resolving', async () => {
        const cached = { token: 't', expiresAt: new Date(Date.now() + 120_000).toISOString(), claims: claims() };
        redis.get.mockResolvedValue(cached as never);

        const resolved = await resolver.resolve('hydra.jwt.token');

        expect(resolved.token).toBe('t');
        expect(resolved.expiresAt).toBeInstanceOf(Date);
        expect(findUser).not.toHaveBeenCalled();
    });

    it('never serves an API key from the exchange cache — its own cache is what revocation clears', async () => {
        redis.get.mockResolvedValue({ token: 'stale', expiresAt: new Date(Date.now() + 120_000).toISOString(), claims: claims() } as never);
        apiKeys.validateKey.mockResolvedValue(null);

        await expect(resolver.resolve('rai_live_revoked')).rejects.toBeInstanceOf(BaseException);
        expect(apiKeys.validateKey).toHaveBeenCalledWith('rai_live_revoked');
    });
});

describe('IdentityGatewayController', () => {
    const credentials = mock<CredentialResolverService>();
    const controller = new IdentityGatewayController(credentials, new InternalTokenService(configWith()));
    const response = { setHeader: jest.fn() };

    const call = (headers: Record<string, string | undefined>, caller: TokenExchangeCaller | undefined) =>
        controller.validateToken(headers, { tokenExchangeCaller: caller } as never, response as never);

    beforeEach(() => {
        credentials.resolve.mockReset();
        response.setHeader.mockReset();
    });

    describe('given the gateway exchanged a credential', () => {
        it('then it reads the credential from the forwarded Authorization header', async () => {
            credentials.resolve.mockResolvedValue({ token: 'internal.jwt', expiresAt: new Date(), claims: claims() });

            const body = await call({ authorization: 'Bearer hydra.jwt' }, 'gateway');

            expect(credentials.resolve).toHaveBeenCalledWith('hydra.jwt');
            expect(body.token).toBe('internal.jwt');
        });

        it('then it returns the internal JWT in the Authorization header for Traefik forwardAuth', async () => {
            credentials.resolve.mockResolvedValue({ token: 'internal.jwt', expiresAt: new Date(), claims: claims() });

            await call({ authorization: 'Bearer hydra.jwt' }, 'gateway');

            expect(response.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer internal.jwt');
        });

        it('then a call carrying no credential at all is refused', async () => {
            const error = await call({}, 'gateway').catch((e: BaseException) => e);

            expect((error as BaseException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
            expect(credentials.resolve).not.toHaveBeenCalled();
        });
    });

    describe('given a service exchanged a credential', () => {
        it('then it reads the credential from X-Api-Key', async () => {
            credentials.resolve.mockResolvedValue({ token: 'internal.jwt', expiresAt: new Date(), claims: claims() });

            await call({ 'x-api-key': 'rai_live_abc', authorization: 'Bearer the.service.token' }, 'service');

            expect(credentials.resolve).toHaveBeenCalledWith('rai_live_abc');
        });

        /**
         * The reason the bearer fallback is not shared between the two paths. A service caller's
         * `Authorization` is its *own* token; falling back to it would exchange the service's identity
         * as though it were a tenant's credential.
         */
        it('then it never falls back to the bearer, which is the service own token', async () => {
            const error = await call({ authorization: 'Bearer the.service.token' }, 'service').catch((e: BaseException) => e);

            expect((error as BaseException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
            expect(credentials.resolve).not.toHaveBeenCalled();
        });
    });
});

/**
 * Who may exchange a credential. Two callers with two different proofs, because the endpoint has two
 * legitimate ones: Traefik's forwardAuth and Event Ingestion, which Architecture §12.1 lists "the
 * Tenant token call" against and which is the one service that receives API keys (R-SDK-07).
 */
describe('TokenExchangeCallerGuard', () => {
    const authorization = mock<AuthorizationService>();

    /** Stubs out passport, so the capability decision is what these tests measure. */
    class TestableGuard extends TokenExchangeCallerGuard {
        constructor(private readonly principal: Partial<IAuthenticatedUser> | undefined) {
            super(configWith() as never, authorization, loggerStub() as never);
        }

        protected override authenticate(context: ExecutionContext): Promise<void> {
            if (!this.principal) {
                return Promise.reject(new BaseException('authentication_error', 'Unauthorized', HttpStatus.UNAUTHORIZED));
            }
            context.switchToHttp().getRequest<{ user?: unknown }>().user = this.principal;
            return Promise.resolve();
        }
    }

    const contextFor = (headers: Record<string, string | undefined>) => {
        const request: Record<string, unknown> = { headers };
        return {
            switchToHttp: () => ({ getRequest: () => request }),
            getHandler: () => undefined,
            getClass: () => undefined
        } as unknown as ExecutionContext & { __request: Record<string, unknown> };
    };

    beforeEach(() => authorization.serviceHas.mockReset());

    describe('given the gateway secret', () => {
        it('then the call is allowed and marked as the gateway', async () => {
            const context = contextFor({ 'x-gateway-secret': GATEWAY_SECRET });

            await expect(new TestableGuard(undefined).canActivate(context)).resolves.toBe(true);
            expect(context.switchToHttp().getRequest<{ tokenExchangeCaller?: string }>().tokenExchangeCaller).toBe('gateway');
        });

        it('then a wrong or truncated secret is refused without consulting Keto', async () => {
            for (const secret of ['wrong', `${GATEWAY_SECRET}x`, '']) {
                const error = await new TestableGuard(undefined)
                    .canActivate(contextFor({ 'x-gateway-secret': secret }))
                    .catch((e: BaseException) => e);
                expect((error as BaseException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
            }
            expect(authorization.serviceHas).not.toHaveBeenCalled();
        });
    });

    describe('given a service token instead', () => {
        it('then a service holding token_exchange.call is allowed and marked as a service', async () => {
            authorization.serviceHas.mockResolvedValue(true);
            const context = contextFor({ authorization: 'Bearer svc.jwt' });

            await expect(new TestableGuard({ isServiceToken: true, clientId: 'ingestion-svc' }).canActivate(context)).resolves.toBe(true);
            expect(authorization.serviceHas).toHaveBeenCalledWith('ingestion-svc', ServiceCapability.TOKEN_EXCHANGE_CALL);
            expect(context.switchToHttp().getRequest<{ tokenExchangeCaller?: string }>().tokenExchangeCaller).toBe('service');
        });

        /** Deny-by-default: holding a valid service token is not the same as being allowed to mint JWTs. */
        it('then a service without the capability is refused with 403', async () => {
            authorization.serviceHas.mockResolvedValue(false);

            const error = await new TestableGuard({ isServiceToken: true, clientId: 'analytics-svc' })
                .canActivate(contextFor({ authorization: 'Bearer svc.jwt' }))
                .catch((e: BaseException) => e);

            expect((error as BaseException).getStatus()).toBe(HttpStatus.FORBIDDEN);
        });

        it('then a human token is refused, however well authenticated', async () => {
            const error = await new TestableGuard({ isServiceToken: false, userId: 'user-1' })
                .canActivate(contextFor({ authorization: 'Bearer human.jwt' }))
                .catch((e: BaseException) => e);

            expect((error as BaseException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
            expect(authorization.serviceHas).not.toHaveBeenCalled();
        });

        it('then no credential of any kind is refused', async () => {
            const error = await new TestableGuard(undefined).canActivate(contextFor({})).catch((e: BaseException) => e);

            expect((error as BaseException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        });
    });
});
