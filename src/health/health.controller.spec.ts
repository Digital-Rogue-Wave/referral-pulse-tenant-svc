import { Reflector } from '@nestjs/core';

import { HealthController } from './health.module';
import { PERMISSIONS_KEY } from '@common/auth/require-permission.decorator';
import { KetoNamespace, KetoRelation } from '@common/auth/keto.constants';
import { IS_PUBLIC_KEY } from '@app/types';

import type { KetoPermission } from '@app/types';

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

    const permissions = (handler: Handler): KetoPermission[] | undefined =>
        reflector.get<KetoPermission[]>(PERMISSIONS_KEY, HealthController.prototype[handler]);

    it('keeps the three probes public for the load balancer', () => {
        expect(isPublic('liveness')).toBe(true);
        expect(isPublic('readiness')).toBe(true);
        expect(isPublic('check')).toBe(true);
    });

    it('no longer marks the whole controller public — that is what exposed the breaker routes', () => {
        expect(reflector.get<boolean>(IS_PUBLIC_KEY, HealthController)).toBeUndefined();
    });

    it('requires a read permission to inspect circuit-breaker state', () => {
        for (const handler of ['getCircuitBreakers', 'getCircuitBreaker'] as const) {
            expect(isPublic(handler)).toBe(false);
            expect(permissions(handler)).toHaveLength(1);
            expect(permissions(handler)![0]).toMatchObject({
                namespace: KetoNamespace.TENANT,
                relation: KetoRelation.READ
            });
        }
    });

    it('requires an update permission to reset a circuit breaker, since it mutates runtime state', () => {
        expect(isPublic('resetCircuitBreaker')).toBe(false);
        expect(permissions('resetCircuitBreaker')![0]).toMatchObject({
            namespace: KetoNamespace.TENANT,
            relation: KetoRelation.UPDATE
        });
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
