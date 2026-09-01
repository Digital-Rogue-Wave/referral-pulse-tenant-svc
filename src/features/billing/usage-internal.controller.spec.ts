import { Reflector } from '@nestjs/core';

import { UsageInternalController } from './usage-internal.controller';
import { PERMISSIONS_KEY } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation } from '@common/auth/keto.constants';

import type { KetoPermission } from '@app/types';

/**
 * These routes take the target tenant from the path and write to that tenant's
 * billing counters. They previously carried no @RequirePermission at all, and
 * PermissionGuard passes through when no permission metadata is present — so any
 * authenticated principal could move any tenant's usage. The assertions below
 * pin the guard metadata that closes that hole.
 */
describe('UsageInternalController authorization', () => {
    const reflector = new Reflector();

    const permissionsFor = (handler: 'incrementUsage' | 'decrementUsage'): KetoPermission[] | undefined =>
        reflector.get<KetoPermission[]>(PERMISSIONS_KEY, UsageInternalController.prototype[handler]);

    describe.each(['incrementUsage', 'decrementUsage'] as const)('%s', (handler) => {
        it('requires a permission — without one PermissionGuard would pass the request through', () => {
            expect(permissionsFor(handler)).toBeDefined();
            expect(permissionsFor(handler)).toHaveLength(1);
        });

        it('binds the check to the tenant in the path, not to the caller’s own tenant', () => {
            const [permission] = permissionsFor(handler)!;

            expect(permission.objectParam).toBe('tenantId');
            expect(permission.namespace).toBe(KetoNamespace.TENANT);
        });

        it('requires update, since both routes mutate billing counters', () => {
            const [permission] = permissionsFor(handler)!;

            expect(permission.relation).toBe(KetoRelation.UPDATE);
        });

        it('still admits service tokens, which are the intended internal callers', () => {
            const [permission] = permissionsFor(handler)!;

            expect(permission.allowServiceTokens).toBe(true);
        });
    });
});
