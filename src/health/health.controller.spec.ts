import { Reflector } from '@nestjs/core';

import { HealthController } from './health.module';
import { PLATFORM_ADMIN_KEY } from '@common/auth/require-permission.decorator';
import { IS_PUBLIC_KEY } from '@app/types';

type Handler = 'liveness' | 'readiness' | 'check' | 'getCircuitBreakers' | 'getCircuitBreaker' | 'resetCircuitBreaker';

/**
 * Two defects fixed here, both verified against a running instance:
 *
 * 1. The database probe used `TypeOrmHealthIndicator` — a leftover from before the
 *    platform moved to Prisma. `@nestjs/terminus` ships indicators for several ORMs,
 *    so it imported cleanly with no TypeORM installed and then could never resolve a
 *    DataSource, making `/health/ready` and `/health` 503 permanently. After the swap
 *    to `PrismaHealthIndicator`, `GET /v1/health/ready` returns 200 with
 *    `{"database":{"status":"up"},"redis":{"status":"up"}}`.
 *
 * 2. `@Public()` sat at class level, so it also covered the circuit-breaker routes —
 *    internal topology on the reads, unauthenticated state mutation on the reset.
 *    `GET /api/v1/health/circuit-breakers` now returns 401.
 */
describe('HealthController', () => {
    const reflector = new Reflector();

    const isPublic = (handler: Handler): boolean =>
        reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [HealthController.prototype[handler], HealthController]) === true;

    const isPlatformAdminOnly = (handler: Handler): boolean =>
        reflector.get<boolean>(PLATFORM_ADMIN_KEY, HealthController.prototype[handler]) === true;

    it('keeps the three probes public for the load balancer', () => {
        expect(isPublic('liveness')).toBe(true);
        expect(isPublic('readiness')).toBe(true);
        expect(isPublic('check')).toBe(true);
    });

    it('no longer marks the whole controller public — that is what exposed the breaker routes', () => {
        expect(reflector.get<boolean>(IS_PUBLIC_KEY, HealthController)).toBeUndefined();
    });

    it('restricts circuit-breaker inspection to platform administrators — breaker state is platform topology, not tenant data', () => {
        for (const handler of ['getCircuitBreakers', 'getCircuitBreaker'] as const) {
            expect(isPublic(handler)).toBe(false);
            expect(isPlatformAdminOnly(handler)).toBe(true);
        }
    });

    it('restricts resetting a circuit breaker to platform administrators, since it mutates runtime state for every tenant', () => {
        expect(isPublic('resetCircuitBreaker')).toBe(false);
        expect(isPlatformAdminOnly('resetCircuitBreaker')).toBe(true);
    });

    it('uses the Prisma database indicator, not the TypeORM one', () => {
        // The constructor's design-time parameter types are the ground truth here: a
        // regression back to TypeOrmHealthIndicator would reintroduce the permanent 503.
        const paramTypes = Reflect.getMetadata('design:paramtypes', HealthController) as Array<{ name: string }>;
        const names = paramTypes.map((t) => t?.name);

        expect(names).toContain('PrismaHealthIndicator');
        expect(names).not.toContain('TypeOrmHealthIndicator');
    });
});
