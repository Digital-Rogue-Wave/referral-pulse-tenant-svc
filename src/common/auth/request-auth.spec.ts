import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mock } from 'jest-mock-extended';
import { lastValueFrom, of } from 'rxjs';

import { TenantContextService } from '@app/common/tenant-aware/tenant-context.service';
import { AlsAuthInterceptor } from '@common/interceptor/als-auth.interceptor';
import { DateService } from '@common/helper/date.service';
import { IS_PUBLIC_KEY, ALLOW_NO_TENANT_KEY } from '@app/types';
import type { IAuthenticatedUser } from '@app/types';
import { UsageCounterService } from '@app/features/billing/usage-counter.service';
import { UsageTrackerService } from '@app/features/billing/usage-tracker.service';
import { AppLoggerService } from '@common/logging/app-logger.service';
import { DatabaseService } from '@app/database/database.service';

import { JwtAuthGuard } from './jwt-auth.guard';

const httpContext = (request: object) =>
    ({
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => request })
    }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
    const guard = (metadata: Record<string, boolean>, authenticated: boolean) => {
        const reflector = { getAllAndOverride: (key: string) => metadata[key] } as unknown as Reflector;
        const instance = new JwtAuthGuard(reflector);
        const parent = Object.getPrototypeOf(JwtAuthGuard.prototype) as { canActivate: () => Promise<boolean> };
        jest.spyOn(parent, 'canActivate').mockResolvedValue(authenticated);
        return instance;
    };

    afterEach(() => jest.restoreAllMocks());

    it('lets public routes through without a token', async () => {
        await expect(guard({ [IS_PUBLIC_KEY]: true }, false).canActivate(httpContext({}))).resolves.toBe(true);
    });

    it('requires a tenant on the principal unless the route allows none, or it is a service', async () => {
        const noTenant: IAuthenticatedUser = { userId: 'u1', tenantId: '', source: 'dashboard' };
        await expect(guard({}, true).canActivate(httpContext({ user: noTenant }))).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(guard({ [ALLOW_NO_TENANT_KEY]: true }, true).canActivate(httpContext({ user: noTenant }))).resolves.toBe(true);
        await expect(guard({}, true).canActivate(httpContext({ user: { ...noTenant, isServiceToken: true } }))).resolves.toBe(true);
        await expect(guard({}, false).canActivate(httpContext({}))).resolves.toBe(false);
    });

    it('turns a failed verification into a 401', () => {
        const instance = guard({}, true);
        expect(() => instance.handleRequest(undefined, undefined, { message: 'jwt expired' })).toThrow('jwt expired');
        expect(() => instance.handleRequest(new Error('boom'), undefined, undefined)).toThrow('boom');
        expect(instance.handleRequest(undefined, { userId: 'u1' }, undefined)).toEqual({ userId: 'u1' });
    });
});

describe('AlsAuthInterceptor', () => {
    const context = new TenantContextService(new DateService());
    const interceptor = new AlsAuthInterceptor(new DateService());

    it('runs the handler inside the request context built from headers and the principal', async () => {
        const request = {
            headers: {
                'x-request-id': 'req_1',
                'x-correlation-id': 'corr-1',
                'idempotency-key': 'idem-1',
                'x-forwarded-for': '203.0.113.9, 10.0.0.1',
                'user-agent': 'jest',
                traceparent: '00-trace123-span456-01',
                authorization: 'Bearer internal'
            },
            method: 'POST',
            path: '/v1/x',
            user: { userId: 'u1', tenantId: 't1', source: 'dashboard', identityId: 'k1', clientId: 'svc' }
        };
        let seen: Record<string, unknown> = {};

        await lastValueFrom(
            interceptor.intercept(httpContext(request), {
                handle: () => {
                    seen = { ...context.snapshot() };
                    return of('ok');
                }
            })
        );

        expect(seen).toMatchObject({
            requestId: 'req_1',
            correlationId: 'corr-1',
            tenantId: 't1',
            userId: 'u1',
            idempotencyKey: 'idem-1',
            ip: '203.0.113.9',
            traceId: 'trace123',
            spanId: 'span456',
            metadata: { authHeader: 'Bearer internal', source: 'dashboard', identityId: 'k1', clientId: 'svc' }
        });
    });

    it('generates ids and falls back to the socket address for an anonymous request', async () => {
        let seen: Record<string, unknown> = {};
        await lastValueFrom(
            interceptor.intercept(
                httpContext({ headers: { 'x-b3-traceid': 'b3' }, method: 'GET', path: '/health', socket: { remoteAddress: '10.0.0.2' } }),
                {
                    handle: () => {
                        seen = { ...context.snapshot() };
                        return of('ok');
                    }
                }
            )
        );
        expect(seen).toMatchObject({ tenantId: '', ip: '10.0.0.2', traceId: 'b3' });
        expect(seen.requestId).toEqual(expect.any(String));
    });
});

describe('Usage metering without a plan check', () => {
    const queryRaw = jest.fn();
    const counters = new UsageCounterService({
        $queryRaw: queryRaw,
        usageCounter: {
            findUnique: jest.fn().mockResolvedValue({ value: 7 }),
            findMany: jest.fn().mockResolvedValue([{ metric: 'email_sends', value: 7 }])
        }
    } as unknown as DatabaseService);

    it('reads counters and never queries for a request larger than the limit', async () => {
        await expect(counters.consume('t1', 'email_sends', 11, 10)).resolves.toBeNull();
        expect(queryRaw).not.toHaveBeenCalled();
        await expect(counters.get('t1', 'email_sends')).resolves.toBe(7);
        await expect(counters.current('t1')).resolves.toEqual({ email_sends: 7 });
        await expect(counters.forMonth('t1', '2026-08')).resolves.toEqual({ email_sends: 7 });
    });

    it('meters for the tenant in context, and not at all without one', async () => {
        const tenantContext = mock<TenantContextService>();
        const counterMock = mock<UsageCounterService>();
        counterMock.consume.mockResolvedValue(3);
        counterMock.release.mockResolvedValue(2);
        counterMock.get.mockResolvedValue(3);
        const tracker = new UsageTrackerService(tenantContext, counterMock, mock<AppLoggerService>());

        await expect(tracker.increment('email_sends')).resolves.toBe(0);
        tenantContext.getTenantId.mockReturnValue('t1');
        await expect(tracker.increment('email_sends', 1)).resolves.toBe(3);
        await expect(tracker.increment('email_sends', 0)).resolves.toBe(3);
        await expect(tracker.decrement('email_sends', 1)).resolves.toBe(2);
        await expect(tracker.getUsage('email_sends')).resolves.toBe(3);
        expect(counterMock.consume).toHaveBeenCalledWith('t1', 'email_sends', 1, null);
    });
});
