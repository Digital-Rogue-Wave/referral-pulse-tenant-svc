import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mock, MockProxy } from 'jest-mock-extended';

import type { IAuthenticatedUser } from '@app/types';
import { IS_PUBLIC_KEY } from '@app/types';

import { BaseException } from '@common/exceptions/base.exceptions';
import { AppLoggerService } from '@common/logging/app-logger.service';

import { AuthorizationService } from './authz/authorization.service';
import { ServiceCapability } from './authz/keto-tuples';
import { PermissionGuard } from './permission.guard';
import { PERMISSIONS_KEY, PLATFORM_ADMIN_KEY, SERVICE_CAPABILITIES_KEY } from './require-permission.decorator';

type RouteMetadata = Partial<Record<string, unknown>>;

const human = (perms: string[] = []): IAuthenticatedUser => ({ userId: 'user-1', tenantId: 'tenant-1', source: 'dashboard', perms });
const service: IAuthenticatedUser = { userId: '', tenantId: '', source: 'client_credentials', isServiceToken: true, clientId: 'workflow-svc' };
const apiKey: IAuthenticatedUser = { userId: '', tenantId: 'tenant-1', source: 'api_key', keyType: 'secret', keyId: 'key-1' };

describe('PermissionGuard — deny-by-default authorization (API Contract v1.3 §2)', () => {
    let authorization: MockProxy<AuthorizationService>;

    beforeEach(() => {
        authorization = mock<AuthorizationService>();
    });

    const run = async (user: IAuthenticatedUser | undefined, metadata: RouteMetadata): Promise<boolean | BaseException> => {
        const reflector = { getAllAndOverride: (key: string) => metadata[key] } as unknown as Reflector;
        const guard = new PermissionGuard(reflector, authorization, mock<AppLoggerService>());
        const context = {
            getHandler: () => undefined,
            getClass: () => undefined,
            switchToHttp: () => ({ getRequest: () => ({ user }) })
        } as unknown as ExecutionContext;
        return guard.canActivate(context).catch((error: BaseException) => error);
    };

    const expectDenied = (result: boolean | BaseException): void => {
        expect(result).toBeInstanceOf(BaseException);
        expect((result as BaseException).getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect((result as BaseException).getCode()).toBe('authorization_error');
    };

    it('lets public routes through without a principal', async () => {
        expect(await run(undefined, { [IS_PUBLIC_KEY]: true })).toBe(true);
    });

    describe('given an API-key principal', () => {
        it('then every tenant-service route is refused — keys are limited to ingestion and the SDK', async () => {
            expectDenied(await run(apiKey, {}));
            expectDenied(await run(apiKey, { [PERMISSIONS_KEY]: ['tenants:read'] }));
        });
    });

    describe('given a service (client-credentials) principal', () => {
        it('then a route granting its capability admits it once Keto confirms the grant', async () => {
            authorization.serviceHas.mockResolvedValue(true);
            expect(await run(service, { [SERVICE_CAPABILITIES_KEY]: [ServiceCapability.USAGE_WRITE] })).toBe(true);
            expect(authorization.serviceHas).toHaveBeenCalledWith('workflow-svc', ServiceCapability.USAGE_WRITE);
        });

        it('then it is refused when Keto has no grant for its client', async () => {
            authorization.serviceHas.mockResolvedValue(false);
            expectDenied(await run(service, { [SERVICE_CAPABILITIES_KEY]: [ServiceCapability.USAGE_WRITE] }));
        });

        it('then it is refused on any route that does not list service capabilities', async () => {
            expectDenied(await run(service, { [PERMISSIONS_KEY]: ['tenants:read'] }));
            expect(authorization.serviceHas).not.toHaveBeenCalled();
        });
    });

    describe('given a dashboard user', () => {
        it('then a coarse permission is authorized from the JWT snapshot without calling Keto', async () => {
            expect(await run(human(['tenants:read']), { [PERMISSIONS_KEY]: ['tenants:read'] })).toBe(true);
            expect(authorization.userHas).not.toHaveBeenCalled();
        });

        it('then a coarse permission missing from the snapshot is refused', async () => {
            expectDenied(await run(human(['tenants:read']), { [PERMISSIONS_KEY]: ['tenants:write'] }));
        });

        it('then a high-risk permission is re-checked against Keto even when the snapshot carries it', async () => {
            authorization.userHas.mockResolvedValue(false);
            expectDenied(await run(human(['api_keys:manage']), { [PERMISSIONS_KEY]: ['api_keys:manage'] }));
            expect(authorization.userHas).toHaveBeenCalledWith('user-1', 'tenant-1', 'api_keys:manage');
        });

        it('then a high-risk permission Keto grants is allowed', async () => {
            authorization.userHas.mockResolvedValue(true);
            expect(await run(human(), { [PERMISSIONS_KEY]: ['users:write'] })).toBe(true);
        });

        it('then a platform-admin route needs a live platform grant, whatever the tenant role', async () => {
            authorization.isPlatformAdmin.mockResolvedValue(false);
            expectDenied(await run(human(['tenants:write', 'tenants:delete']), { [PLATFORM_ADMIN_KEY]: true }));

            authorization.isPlatformAdmin.mockResolvedValue(true);
            expect(await run(human(), { [PLATFORM_ADMIN_KEY]: true })).toBe(true);
        });

        it('then a route that lists only service capabilities is refused — it is service-to-service', async () => {
            expectDenied(await run(human(['tenants:write']), { [SERVICE_CAPABILITIES_KEY]: [ServiceCapability.USAGE_WRITE] }));
        });

        it('then a principal without a tenant cannot pass a tenant-scoped permission', async () => {
            expectDenied(await run({ ...human(['tenants:read']), tenantId: '' }, { [PERMISSIONS_KEY]: ['tenants:read'] }));
        });

        it('then an authenticated route with no permission metadata is allowed (e.g. /users/me)', async () => {
            expect(await run(human(), {})).toBe(true);
        });
    });
});
