import { mock, MockProxy } from 'jest-mock-extended';

import { RoleEnum } from '@common/enums/role.enum';
import { RedisService } from '@common/redis/redis.service';

import { KetoService, KetoTuplePatch } from '../keto.service';
import { AuthorizationService } from './authorization.service';
import { KetoProvisioningService } from './keto-provisioning.service';
import { membershipTuple, roleObject, tenantGrantTuples, ServiceCapability } from './keto-tuples';
import { ALL_PERMISSIONS, LIVE_CHECK_PERMISSIONS, PERMISSION_CATALOG, ROLE_GRANTS } from './permission-catalog';

describe('Permission catalog (API Contract v1.3 §2)', () => {
    it('covers every namespace the spec defines, with the spec relations', () => {
        expect(PERMISSION_CATALOG.campaigns).toEqual(['read', 'write', 'activate', 'pause', 'complete']);
        expect(PERMISSION_CATALOG.rewards).toEqual(['read', 'approve', 'reject', 'clawback']);
        expect(PERMISSION_CATALOG.api_keys).toEqual(['manage']);
    });

    it('gives the Owner every permission', () => {
        expect(ROLE_GRANTS[RoleEnum.OWNER]).toEqual(ALL_PERMISSIONS);
    });

    it('gives the Admin everything except billing and tenant deletion', () => {
        const admin = ROLE_GRANTS[RoleEnum.ADMIN];
        expect(admin.some((p) => p.startsWith('billing:'))).toBe(false);
        expect(admin).not.toContain('tenants:delete');
        expect(admin).toEqual(expect.arrayContaining(['api_keys:manage', 'users:write', 'payouts:confirm']));
    });

    it('matches the spec Operator and Viewer rows (plus reading their own tenant)', () => {
        expect(ROLE_GRANTS[RoleEnum.OPERATOR]).toEqual(expect.arrayContaining(['campaigns:activate', 'rewards:approve', 'analytics:read']));
        expect(ROLE_GRANTS[RoleEnum.OPERATOR]).not.toContain('payouts:confirm');
        expect([...ROLE_GRANTS[RoleEnum.VIEWER]].sort()).toEqual([
            'analytics:read',
            'campaigns:read',
            'referrals:read',
            'rewards:read',
            'tenants:read'
        ]);
    });

    it('never trusts the JWT snapshot for money, keys or membership changes', () => {
        for (const permission of [
            'rewards:approve',
            'rewards:clawback',
            'payouts:confirm',
            'api_keys:manage',
            'users:write',
            'billing:write'
        ] as const) {
            expect(LIVE_CHECK_PERMISSIONS.has(permission)).toBe(true);
        }
        expect(LIVE_CHECK_PERMISSIONS.has('campaigns:read')).toBe(false);
    });
});

describe('Keto tuples', () => {
    it('scopes role objects to the tenant, so a role in one tenant grants nothing in another', () => {
        expect(roleObject('t1', RoleEnum.OPERATOR)).toBe('t1:operator');
        expect(membershipTuple('t1', RoleEnum.ADMIN, 'u1')).toEqual({
            namespace: 'role',
            object: 't1:admin',
            relation: 'member',
            subject_id: 'user:u1'
        });
    });

    it('writes one grant per role permission, each pointing at that tenant’s role members', () => {
        const tuples = tenantGrantTuples('t1');
        const expected = Object.values(ROLE_GRANTS).reduce((sum, grants) => sum + grants.length, 0);
        expect(tuples).toHaveLength(expected);
        expect(tuples).toContainEqual({
            namespace: 'campaigns',
            object: 't1',
            relation: 'write',
            subject_set: { namespace: 'role', object: 't1:operator', relation: 'member' }
        });
        expect(tuples.every((t) => t.object === 't1')).toBe(true);
    });
});

describe('AuthorizationService', () => {
    let keto: MockProxy<KetoService>;
    let redis: MockProxy<RedisService>;
    let cache: Map<string, string>;
    let service: AuthorizationService;

    beforeEach(() => {
        keto = mock<KetoService>();
        redis = mock<RedisService>();
        cache = new Map();
        redis.get.mockImplementation(async (key: string) => cache.get(key) as never);
        redis.set.mockImplementation(async (key: string, value: unknown) => {
            cache.set(key, value as string);
        });
        service = new AuthorizationService(keto, redis);
    });

    it('asks Keto on a cache miss and caches the decision for 30–60 s', async () => {
        keto.check.mockResolvedValue(true);

        expect(await service.userHas('u1', 't1', 'campaigns:write')).toBe(true);
        expect(await service.userHas('u1', 't1', 'campaigns:write')).toBe(true);

        expect(keto.check).toHaveBeenCalledTimes(1);
        expect(keto.check).toHaveBeenCalledWith('campaigns', 't1', 'write', 'user:u1');
        const ttl = (redis.set.mock.calls[0]![2] as { ttl: number }).ttl;
        expect(ttl).toBeGreaterThanOrEqual(30);
        expect(ttl).toBeLessThanOrEqual(60);
    });

    it('caches denials too', async () => {
        keto.check.mockResolvedValue(false);
        await service.userHas('u1', 't1', 'billing:write');
        expect(await service.userHas('u1', 't1', 'billing:write')).toBe(false);
        expect(keto.check).toHaveBeenCalledTimes(1);
    });

    it('resolves the perms snapshot as exactly the catalog permissions Keto grants', async () => {
        keto.check.mockImplementation(async (namespace, _object, relation) => namespace === 'campaigns' && relation === 'read');
        expect(await service.resolvePermissions('u1', 't1')).toEqual(['campaigns:read']);
        expect(keto.check).toHaveBeenCalledTimes(ALL_PERMISSIONS.length);
    });

    it('checks platform admins and service capabilities on their own namespaces', async () => {
        keto.check.mockResolvedValue(true);
        await service.isPlatformAdmin('u9');
        await service.serviceHas('workflow-svc', ServiceCapability.TENANT_STATUS_READ);
        expect(keto.check).toHaveBeenCalledWith('platform', 'referralai', 'admin', 'user:u9');
        expect(keto.check).toHaveBeenCalledWith('services', 'tenant_status.read', 'call', 'service:workflow-svc');
    });
});

describe('KetoProvisioningService', () => {
    let keto: MockProxy<KetoService>;
    let provisioning: KetoProvisioningService;

    beforeEach(() => {
        keto = mock<KetoService>();
        provisioning = new KetoProvisioningService(keto);
    });

    it('makes a role the member’s only role, in one atomic patch', async () => {
        await provisioning.assignRole('t1', 'u1', RoleEnum.ADMIN);

        const patches = keto.patchTuples.mock.calls[0]![0] as KetoTuplePatch[];
        expect(patches.filter((p) => p.action === 'insert')).toEqual([
            { action: 'insert', relation_tuple: membershipTuple('t1', RoleEnum.ADMIN, 'u1') }
        ]);
        expect(patches.filter((p) => p.action === 'delete')).toHaveLength(3);
    });

    it('removes every membership of a removed user', async () => {
        await provisioning.removeMember('t1', 'u1');
        const patches = keto.patchTuples.mock.calls[0]![0] as KetoTuplePatch[];
        expect(patches).toHaveLength(4);
        expect(patches.every((p) => p.action === 'delete')).toBe(true);
    });

    it('revokes every grant and membership of a deleted tenant', async () => {
        await provisioning.revokeTenant('t1');
        expect(keto.deleteTuples).toHaveBeenCalledWith({ namespace: 'campaigns', object: 't1' });
        expect(keto.deleteTuples).toHaveBeenCalledWith({ namespace: 'role', object: 't1:owner', relation: 'member' });
        expect(keto.deleteTuples).toHaveBeenCalledTimes(Object.keys(PERMISSION_CATALOG).length + 4);
    });

    it('grants a new tenant its full role matrix', async () => {
        await provisioning.grantTenant('t1');
        expect(keto.patchTuples.mock.calls[0]![0]).toHaveLength(tenantGrantTuples('t1').length);
    });
});

describe('Keto namespace deployment config', () => {
    it('declares exactly the namespaces the permission catalog and tuple model use — Keto rejects tuples in undeclared namespaces', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readdirSync, readFileSync } = require('fs') as typeof import('fs');
        const dir = `${__dirname}/../../../../deployment/ory/keto/namespaces`;
        const declared = readdirSync(dir).map((file) => (JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as { name: string }).name);

        expect(declared.sort()).toEqual(['platform', 'role', 'services', ...Object.keys(PERMISSION_CATALOG)].sort());
    });
});
