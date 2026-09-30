import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mock, MockProxy } from 'jest-mock-extended';

import type { IJwtPayload } from '@app/types';

import { HttpClientService } from '@common/http/http-client.service';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { JwtStrategy } from './jwt.strategy';
import { KratosService } from './kratos.service';

const config = {
    getOrThrow: (key: string) =>
        ({
            auth: {
                jwksUri: 'http://hydra.test/.well-known/jwks.json',
                issuer: 'http://hydra.test/',
                audience: 'dashboard',
                internalJwksUri: 'http://tenant.test/.well-known/jwks.json',
                internalIssuer: 'referralai-tenant-svc',
                internalAudience: 'referralai-internal',
                algorithms: ['RS256', 'ES256'],
                clockTolerance: 0,
                cacheEnabled: false,
                cacheTtl: 60
            },
            oryConfig: { kratos: { adminUrl: 'http://kratos-admin', publicUrl: 'http://kratos-public' } }
        })[key]
} as unknown as ConfigService;

describe('JwtStrategy — which tokens become which principals', () => {
    const strategy = new JwtStrategy(config as never);

    it('maps the internal JWT to a dashboard principal carrying the perms snapshot', () => {
        const principal = strategy.validate({
            iss: 'referralai-tenant-svc',
            sub: 'user:u1',
            tenant_id: 't1',
            user_id: 'u1',
            identity_id: 'kratos-1',
            source: 'dashboard',
            key_type: null,
            key_id: null,
            perms: ['tenants:read']
        } as unknown as IJwtPayload);

        expect(principal).toMatchObject({ userId: 'u1', tenantId: 't1', identityId: 'kratos-1', source: 'dashboard', perms: ['tenants:read'] });
        expect(principal.isServiceToken).toBeUndefined();
    });

    it('maps a Hydra client-credentials token to a tenant-less service principal', () => {
        const principal = strategy.validate({ iss: 'http://hydra.test/', sub: 'workflow-svc', client_id: 'workflow-svc' } as IJwtPayload);
        expect(principal).toMatchObject({ isServiceToken: true, clientId: 'workflow-svc', source: 'client_credentials', tenantId: '' });
    });

    it('rejects a Hydra token for a human — dashboard traffic must be exchanged at the gateway', () => {
        expect(() => strategy.validate({ iss: 'http://hydra.test/', sub: 'kratos-1', client_id: 'dashboard-spa' } as IJwtPayload)).toThrow(
            UnauthorizedException
        );
    });
});

describe('KratosService.verifyPassword', () => {
    let http: MockProxy<HttpClientService>;
    let kratos: KratosService;

    beforeEach(() => {
        http = mock<HttpClientService>();
        kratos = new KratosService(http, config, mock<AppLoggerService>());
        http.get.mockImplementation(async (url: string) => {
            if (url.endsWith('/admin/identities/kratos-1')) {
                return { data: { id: 'kratos-1', traits: { email: 'ada@acme.io' } }, status: 200, headers: {}, duration: 1 };
            }
            return { data: { id: 'flow-1' }, status: 200, headers: {}, duration: 1 };
        });
        http.delete.mockResolvedValue({ data: undefined, status: 204, headers: {}, duration: 1 });
    });

    it('confirms a correct password through a native login flow, then revokes the session it created', async () => {
        http.post.mockResolvedValue({ data: { session: { id: 'sess-1' } }, status: 200, headers: {}, duration: 1 });

        expect(await kratos.verifyPassword('kratos-1', 'correct')).toBe(true);

        expect(http.post).toHaveBeenCalledWith(
            'http://kratos-public/self-service/login',
            { method: 'password', identifier: 'ada@acme.io', password: 'correct' },
            { params: { flow: 'flow-1' }, retries: 0, skipCircuitBreaker: true }
        );
        expect(http.delete).toHaveBeenCalledWith('http://kratos-admin/admin/sessions/sess-1');
    });

    it('rejects a wrong password without retrying it or tripping the circuit breaker', async () => {
        http.post.mockRejectedValue(Object.assign(new Error('400'), { status: 400 }));

        expect(await kratos.verifyPassword('kratos-1', 'wrong')).toBe(false);
        expect(http.post).toHaveBeenCalledTimes(1);
        expect(http.delete).not.toHaveBeenCalled();
    });
});
