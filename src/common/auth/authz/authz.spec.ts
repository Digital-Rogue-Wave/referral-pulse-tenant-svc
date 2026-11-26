import { mock, MockProxy } from 'jest-mock-extended';

import { RoleEnum } from '@common/enums/role.enum';
import { RedisService } from '@common/redis/redis.service';

import { KetoService, KetoTuplePatch } from '../keto.service';
import { AuthorizationService } from './authorization.service';
import { KetoProvisioningService } from './keto-provisioning.service';
import { membershipTuple, roleObject, tenantGrantTuples, ServiceCapability } from './keto-tuples';
import { ALL_PERMISSIONS, LIVE_CHECK_PERMISSIONS, PERMISSION_CATALOG, RETIRED_NAMESPACES, ROLE_GRANTS } from './permission-catalog';

describe('Permission catalog (Product Spec v5.2 §4)', () => {
    it('holds exactly the thirteen v5.2 namespaces with their relations', () => {
        expect(PERMISSION_CATALOG).toEqual({
            programs: ['read', 'write', 'archive'],
            campaigns: ['read', 'write', 'activate', 'pause', 'complete'],
            variants: ['read', 'write'],
            segments: ['read', 'write', 'delete'],
            participants: ['read', 'write', 'block', 'review', 'ban', 'note'],
            referrals: ['read', 'reject'],
            rewards: ['read', 'approve', 'reject', 'clawback', 'adjust', 'resend_email'],
            payouts: ['read', 'write', 'confirm', 'cancel'],
            analytics: ['read', 'query'],
            webhooks: ['read', 'write', 'delete'],
            api_keys: ['manage'],
            users: ['read', 'manage'],
            tenant: ['read', 'settings', 'billing']
        });
    });

    /** v5.1: no form of "referrer" anywhere; the Keto namespace is participants. */
    it('has none of the retired namespaces (referrers, dsr, connections, tenants, billing, audit)', () => {
        for (const retired of RETIRED_NAMESPACES) {
            expect(Object.keys(PERMISSION_CATALOG)).not.toContain(retired);
        }
    });

    it('gives the Owner every permission', () => {
        expect(ROLE_GRANTS[RoleEnum.OWNER]).toEqual(ALL_PERMISSIONS);
    });

    /** R-ACT-01: exactly four tenant roles. The retired `admin` grant must not come back. */
    it('grants nothing to any role outside the four', () => {
        expect(Object.keys(ROLE_GRANTS).sort()).toEqual(['operator', 'owner', 'support', 'viewer']);
    });

    it('matches the v5.2 Campaign Manager row exactly', () => {
        expect([...ROLE_GRANTS[RoleEnum.OPERATOR]].sort()).toEqual(
            [
                'analytics:read',
                'campaigns:activate',
                'campaigns:complete',
                'campaigns:pause',
                'campaigns:read',
                'campaigns:write',
                'analytics:query',
                'participants:block',
                'participants:read',
                'participants:review',
                'participants:write',
                'payouts:confirm',
                'payouts:read',
                'payouts:write',
                'programs:read',
                'referrals:read',
                'referrals:reject',
                'rewards:approve',
                'rewards:read',
                'rewards:reject',
                'segments:read',
                'segments:write',
                'variants:read',
                'variants:write',
                'webhooks:read'
            ].sort()
        );
        // Banning and cancelling a payout are the Owner's alone.
        expect(ROLE_GRANTS[RoleEnum.OPERATOR]).not.toContain('participants:ban');
        expect(ROLE_GRANTS[RoleEnum.OPERATOR]).not.toContain('payouts:cancel');
        // Approving a reward is the Operator's; adjusting one is the Support Agent's.
        expect(ROLE_GRANTS[RoleEnum.OPERATOR]).not.toContain('rewards:adjust');
    });

    it('matches the v5.2 Analyst row exactly — never analytics:query', () => {
        expect([...ROLE_GRANTS[RoleEnum.VIEWER]].sort()).toEqual([
            'analytics:read',
            'campaigns:read',
            'payouts:read',
            'programs:read',
            'referrals:read',
            'rewards:read',
            'variants:read'
        ]);
    });

    it('matches the spec Support Agent row — read, plus three live-checked writes', () => {
        expect([...ROLE_GRANTS[RoleEnum.SUPPORT]].sort()).toEqual([
            'analytics:read',
            'participants:note',
            'participants:read',
            'payouts:read',
            'referrals:read',
            'rewards:adjust',
            'rewards:read',
            'rewards:resend_email'
        ]);
        // v5: "Read on referrers/referrals/rewards; limited write". No approvals, no money movement.
        for (const denied of ['rewards:approve', 'rewards:clawback', 'payouts:write', 'campaigns:write'] as const) {
            expect(ROLE_GRANTS[RoleEnum.SUPPORT]).not.toContain(denied);
        }
    });

    it('grants every role a non-empty relation set, so the seeded projection is never empty', () => {
        // The role catalog in the DB derives `keto_relations` from ROLE_GRANTS (src/prisma/seed.ts).
        // A role missing from ROLE_GRANTS would seed an empty relation set, and the dashboard would
        // show a role that grants nothing while the guards grant it plenty.
        for (const role of Object.values(RoleEnum)) {
            expect(ROLE_GRANTS[role].length).toBeGreaterThan(0);
        }
    });

    it('keeps every granted permission inside the catalog, so no role grants a relation Keto has no namespace for', () => {
        for (const [role, grants] of Object.entries(ROLE_GRANTS)) {
            const unknown = grants.filter((permission) => !ALL_PERMISSIONS.includes(permission));
            expect(unknown).toEqual([]);
            expect(role).toBeTruthy();
        }
    });

    it('never trusts the JWT snapshot for money, keys or membership changes', () => {
        for (const permission of [
            'rewards:approve',
            'rewards:clawback',
            'payouts:confirm',
            'api_keys:manage',
            'users:manage',
            'tenant:settings',
            'tenant:billing',
            // v5 marks the Support Agent's three writes "all live Keto + audit trail": a resent
            // reward email or a support note must not be authorized by a token issued before the
            // agent's access was revoked.
            'rewards:adjust',
            'rewards:resend_email',
            'participants:note',
            // v5.1 section 4: banning is terminal and cancelling stops money.
            'participants:ban',
            'payouts:cancel'
        ] as const) {
            expect(LIVE_CHECK_PERMISSIONS.has(permission)).toBe(true);
        }
        expect(LIVE_CHECK_PERMISSIONS.has('campaigns:read')).toBe(false);
    });
});

describe('Keto tuples', () => {
    it('scopes role objects to the tenant, so a role in one tenant grants nothing in another', () => {
        expect(roleObject('t1', RoleEnum.OPERATOR)).toBe('t1:operator');
        expect(membershipTuple('t1', RoleEnum.OPERATOR, 'u1')).toEqual({
            namespace: 'role',
            object: 't1:operator',
            relation: 'member',
            subject_id: 'user:u1'
        });
    });

    it('writes one grant per role permission, each pointing at that tenant’s role members', () => {
        const tuples = tenantGrantTuples('t1').filter((tuple) => tuple.subject_set);
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

    /** v5.1 §4 / API §2: "payouts:tenant_acme#confirm@service:payout-worker", per tenant, never a wildcard (E1 D18). */
    it('writes the narrow service relations for that tenant only', () => {
        expect(tenantGrantTuples('t1').filter((tuple) => tuple.subject_id)).toEqual([
            { namespace: 'payouts', object: 't1', relation: 'confirm', subject_id: 'service:payout-worker' },
            { namespace: 'variants', object: 't1', relation: 'write', subject_id: 'service:ai-optimizer' }
        ]);
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
        await service.userHas('u1', 't1', 'tenant:billing');
        expect(await service.userHas('u1', 't1', 'tenant:billing')).toBe(false);
        expect(keto.check).toHaveBeenCalledTimes(1);
    });

    it('resolves the perms snapshot as exactly the catalog permissions Keto grants', async () => {
        keto.check.mockImplementation(async (namespace, _object, relation) => namespace === 'campaigns' && relation === 'read');
        expect(await service.resolvePermissions('u1', 't1')).toEqual(['campaigns:read']);
        expect(keto.check).toHaveBeenCalledTimes(ALL_PERMISSIONS.length);
    });

    it('checks platform admins and service capabilities on their own namespaces', async () => {
        keto.check.mockResolvedValue(true);
        await service.isPlatformAdmin('kratos-9');
        await service.serviceHas('workflow-svc', ServiceCapability.TENANT_STATUS_READ);
        // E1 D17: the subject is the staff identity, never a tenant user.
        expect(keto.check).toHaveBeenCalledWith('platform', 'referralai', 'admin', 'staff:kratos-9');
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
        await provisioning.assignRole('t1', 'u1', RoleEnum.OPERATOR);

        const patches = keto.patchTuples.mock.calls[0]![0] as KetoTuplePatch[];
        expect(patches.filter((p) => p.action === 'insert')).toEqual([
            { action: 'insert', relation_tuple: membershipTuple('t1', RoleEnum.OPERATOR, 'u1') }
        ]);
        // Every other role is deleted, whatever the role set currently is — derived rather than
        // hardcoded so adding a role (v5 added `support`) does not need this number edited.
        expect(patches.filter((p) => p.action === 'delete')).toHaveLength(Object.keys(RoleEnum).length - 1);
    });

    it('removes every membership of a removed user', async () => {
        await provisioning.removeMember('t1', 'u1');
        const patches = keto.patchTuples.mock.calls[0]![0] as KetoTuplePatch[];
        expect(patches).toHaveLength(Object.keys(RoleEnum).length);
        expect(patches.every((p) => p.action === 'delete')).toBe(true);
    });

    it('revokes every grant and membership of a deleted tenant', async () => {
        await provisioning.revokeTenant('t1');
        expect(keto.deleteTuples).toHaveBeenCalledWith({ namespace: 'campaigns', object: 't1' });
        expect(keto.deleteTuples).toHaveBeenCalledWith({ namespace: 'role', object: 't1:owner', relation: 'member' });
        expect(keto.deleteTuples).toHaveBeenCalledTimes(Object.keys(PERMISSION_CATALOG).length + Object.keys(RoleEnum).length);
    });

    it('grants a new tenant its full role matrix', async () => {
        keto.listTuples.mockResolvedValue([]);
        await provisioning.grantTenant('t1');
        expect(keto.patchTuples.mock.calls[0]![0]).toHaveLength(tenantGrantTuples('t1').length);
    });

    /** A permission taken from a role in the catalogue is taken from every existing tenant too (E1 D2). */
    it('deletes, in the same batch, a role grant the catalogue no longer holds, and leaves direct tuples alone', async () => {
        const stale = {
            namespace: 'segments',
            object: 't1',
            relation: 'read',
            subject_set: { namespace: 'role', object: 't1:viewer', relation: 'member' }
        };
        const kept = tenantGrantTuples('t1').find((tuple) => tuple.namespace === 'segments')!;
        const directUser = { namespace: 'segments', object: 't1', relation: 'read', subject_id: 'user:u9' };
        keto.listTuples.mockImplementation(async (query) => (query.namespace === 'segments' ? [stale, kept, directUser] : []));

        await provisioning.grantTenant('t1');

        const patches = keto.patchTuples.mock.calls[0]![0] as KetoTuplePatch[];
        expect(patches.filter((p) => p.action === 'delete')).toEqual([{ action: 'delete', relation_tuple: stale }]);
        expect(patches.filter((p) => p.action === 'insert')).toHaveLength(tenantGrantTuples('t1').length);
    });

    it('retires the referrers, dsr, connections, tenants, billing and audit namespaces, and survives one already gone from Keto', async () => {
        keto.deleteTuples.mockRejectedValueOnce(new Error('unknown namespace')).mockResolvedValue(undefined);
        await provisioning.retireNamespaces();
        expect(keto.deleteTuples.mock.calls.map(([query]) => query)).toEqual([
            { namespace: 'referrers' },
            { namespace: 'dsr' },
            { namespace: 'connections' },
            { namespace: 'tenants' },
            { namespace: 'billing' },
            { namespace: 'audit' }
        ]);
    });
});

describe('Keto namespace deployment config', () => {
    it('declares exactly the namespaces the permission catalog and tuple model use — Keto rejects tuples in undeclared namespaces', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readdirSync, readFileSync } = require('fs') as typeof import('fs');
        const dir = `${__dirname}/../../../../deployment/ory/keto/namespaces`;
        const declared = readdirSync(dir).map((file) => (JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as { name: string }).name);

        // The retired namespaces stay declared until the v5.1 re-provisioning has deleted their tuples in
        // every environment (expand, then contract); then their files go (NOTE.md V5.24).
        expect(declared.sort()).toEqual(['platform', 'role', 'services', ...Object.keys(PERMISSION_CATALOG), ...RETIRED_NAMESPACES].sort());
    });
});
