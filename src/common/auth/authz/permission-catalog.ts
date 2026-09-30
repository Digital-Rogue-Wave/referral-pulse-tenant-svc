import { RoleEnum } from '@common/enums/role.enum';

/**
 * The platform permission catalog — API Contract v1.3 §2 "Keto Namespace & Relations".
 *
 * tenant-service owns Ory Keto, so this file is the single definition of every namespace/relation the
 * platform checks, which role grants what, and which permissions must never be trusted from the JWT
 * `perms` snapshot. The tuple writer, the `perms` resolver and the guards all read from here, so they
 * cannot drift apart.
 *
 * `tenants`, `users`, `billing` and `audit` are tenant-service's own resources; the spec's table covers
 * only the other domains plus `api_keys`. They are recorded as a decision in NOTE.md.
 */
export const PERMISSION_CATALOG = {
    programs: ['read', 'write', 'archive'],
    campaigns: ['read', 'write', 'activate', 'pause', 'complete'],
    variants: ['read', 'write'],
    segments: ['read', 'write', 'delete'],
    referrers: ['read', 'write', 'block'],
    referrals: ['read', 'reject'],
    rewards: ['read', 'approve', 'reject', 'clawback'],
    analytics: ['read'],
    webhooks: ['read', 'write', 'delete'],
    payouts: ['read', 'write', 'confirm'],
    api_keys: ['manage'],
    tenants: ['read', 'write', 'delete'],
    users: ['read', 'write'],
    billing: ['read', 'write'],
    audit: ['read']
} as const;

export type PermissionNamespace = keyof typeof PERMISSION_CATALOG;
export type Permission = {
    [N in PermissionNamespace]: `${N}:${(typeof PERMISSION_CATALOG)[N][number]}`;
}[PermissionNamespace];

export const ALL_PERMISSIONS: readonly Permission[] = (Object.keys(PERMISSION_CATALOG) as PermissionNamespace[]).flatMap((namespace) =>
    PERMISSION_CATALOG[namespace].map((relation) => `${namespace}:${relation}` as Permission)
);

const withoutNamespaces = (...excluded: PermissionNamespace[]): Permission[] =>
    ALL_PERMISSIONS.filter((permission) => !excluded.includes(permission.split(':')[0] as PermissionNamespace));

/**
 * Role → permission grants (API §2 "Role → Permission Mapping").
 * Admin: "all namespaces except billing" — tenant deletion is also Owner-only (irreversible, and it
 * cancels the subscription). Operator and Viewer additionally read their own tenant profile, which
 * the dashboard needs on every page.
 */
export const ROLE_GRANTS: Readonly<Record<RoleEnum, readonly Permission[]>> = {
    [RoleEnum.OWNER]: ALL_PERMISSIONS,
    [RoleEnum.ADMIN]: withoutNamespaces('billing').filter((permission) => permission !== 'tenants:delete'),
    [RoleEnum.OPERATOR]: [
        'campaigns:read',
        'campaigns:write',
        'campaigns:activate',
        'campaigns:pause',
        'variants:read',
        'variants:write',
        'segments:read',
        'segments:write',
        'referrers:read',
        'referrers:write',
        'rewards:read',
        'rewards:approve',
        'rewards:reject',
        'analytics:read',
        'tenants:read'
    ],
    [RoleEnum.VIEWER]: ['campaigns:read', 'referrals:read', 'rewards:read', 'analytics:read', 'tenants:read']
};

/**
 * Permissions that are always re-checked against Keto live, never authorized from the JWT snapshot
 * (API §2 "Enforcement split"): money, key management, and — for this service — role changes, billing
 * changes and tenant deletion, where a stale token must not win.
 */
export const LIVE_CHECK_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
    'rewards:approve',
    'rewards:reject',
    'rewards:clawback',
    'payouts:write',
    'payouts:confirm',
    'api_keys:manage',
    'users:write',
    'billing:write',
    'tenants:delete'
]);

/** Role hierarchy used to stop a principal granting a role above their own. */
export const ROLE_RANK: Readonly<Record<RoleEnum, number>> = {
    [RoleEnum.OWNER]: 4,
    [RoleEnum.ADMIN]: 3,
    [RoleEnum.OPERATOR]: 2,
    [RoleEnum.VIEWER]: 1
};

export function splitPermission(permission: Permission): { namespace: PermissionNamespace; relation: string } {
    const [namespace, relation] = permission.split(':') as [PermissionNamespace, string];
    return { namespace, relation };
}
