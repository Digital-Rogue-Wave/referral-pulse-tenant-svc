import { readdirSync, statSync } from 'fs';
import { join } from 'path';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { RoleEnum } from '@common/enums/role.enum';

import { PERMISSIONS_KEY } from '../require-permission.decorator';
import { ROLE_GRANTS } from './permission-catalog';

const MUTATING = new Set<RequestMethod>([RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]);
const SRC = join(__dirname, '..', '..', '..');

type ControllerClass = { name: string; prototype: Record<string, unknown> };

function controllerFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
            return controllerFiles(path);
        }
        return entry.endsWith('.controller.ts') ? [path] : [];
    });
}

/** Every mutating handler of every controller in the service, with the permissions its route requires. */
function mutatingRoutes(): { route: string; permissions: string[] }[] {
    return controllerFiles(SRC).flatMap((file) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- the point is to load every controller file
        const exported = Object.values(require(file) as Record<string, unknown>);
        const controllers = exported.filter(
            (value): value is ControllerClass => typeof value === 'function' && Reflect.hasMetadata(PATH_METADATA, value)
        );
        return controllers.flatMap((controller) =>
            Object.getOwnPropertyNames(controller.prototype)
                .filter((name) => name !== 'constructor')
                .map((name) => ({ name, handler: controller.prototype[name] }))
                .filter(
                    ({ handler }) => typeof handler === 'function' && MUTATING.has(Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod)
                )
                .map(({ name, handler }) => ({
                    route: `${controller.name}.${name}`,
                    permissions:
                        ((Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? Reflect.getMetadata(PERMISSIONS_KEY, controller)) as
                            | string[]
                            | undefined) ?? []
                }))
        );
    });
}

/**
 * US1.3.3 F3: the Analyst (Viewer) is read-only. Every write route that requires a permission must require one the
 * Analyst does not hold, so a route that would open a write to the Analyst fails here before it ships.
 */
describe('Analyst read-only (US1.3.3)', () => {
    const routes = mutatingRoutes();
    const analyst = new Set<string>(ROLE_GRANTS[RoleEnum.VIEWER]);

    it('finds the service write routes it guards', () => {
        expect(routes.filter((route) => route.permissions.length > 0).length).toBeGreaterThan(20);
    });

    it.each(routes.filter((route) => route.permissions.length > 0).map((route) => [route.route, route.permissions] as const))(
        'given an Analyst, %s refuses them (requires %j)',
        (_route, permissions) => {
            expect(permissions.filter((permission) => analyst.has(permission))).toEqual([]);
        }
    );

    it('grants the Analyst reads only', () => {
        expect([...analyst].filter((permission) => !permission.endsWith(':read'))).toEqual([]);
    });
});
