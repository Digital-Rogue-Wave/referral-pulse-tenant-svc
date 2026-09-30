import { Reflector } from '@nestjs/core';

import { UsageInternalController } from './usage-internal.controller';
import { PERMISSIONS_KEY, PLATFORM_ADMIN_KEY, SERVICE_CAPABILITIES_KEY } from '@common/auth/require-permission.decorator';
import { ServiceCapability } from '@common/auth/authz/keto-tuples';

/**
 * These routes take the target tenant from the path and write to that tenant's billing counters. They
 * are service-to-service only: a client-credentials token whose client Keto grants `usage.write`. No
 * human permission is attached, and PermissionGuard treats a route that lists only service capabilities
 * as service-only, so no dashboard user — whatever their role — can reach another tenant's counters.
 */
describe('UsageInternalController authorization', () => {
    const reflector = new Reflector();

    describe.each(['incrementUsage', 'decrementUsage'] as const)('given the %s route', (handler) => {
        const metadata = (key: string): unknown => reflector.get(key, UsageInternalController.prototype[handler]);

        it('then only services granted the usage.write capability are admitted', () => {
            expect(metadata(SERVICE_CAPABILITIES_KEY)).toEqual([ServiceCapability.USAGE_WRITE]);
        });

        it('then no tenant-scoped human permission opens it', () => {
            expect(metadata(PERMISSIONS_KEY)).toBeUndefined();
            expect(metadata(PLATFORM_ADMIN_KEY)).toBeUndefined();
        });
    });
});
