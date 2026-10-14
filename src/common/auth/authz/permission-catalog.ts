import { RoleEnum } from '@common/enums/role.enum';

/**
 * The platform permission catalog — API Contract v5 §2 "Keto Namespace & Relations".
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
    // v5 §2's namespace table calls this one `participants`, but its role mapping, actor table and
    // tuple examples all say `referrers` — 31 occurrences across the suite against none of the
    // other. A namespace is an exact string, so `participants:note` would write a tuple nothing
    // checks. Kept as `referrers`; raised as a spec defect (NOTE.md decision T-2).
    referrers: ['read', 'write', 'block', 'note'],
    referrals: ['read', 'reject'],
    rewards: ['read', 'approve', 'reject', 'clawback', 'adjust', 'resend_email'],
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
 * Role → permission grants (API Contract v5 §2 "Role → Permission Mapping").
 *
 * Operator and Viewer additionally read their own tenant profile, which the dashboard needs on every
 * page; Admin is the custom role v5 does not define, kept at "all namespaces except billing" with
 * tenant deletion reserved to the Owner (irreversible, and it cancels the subscription).
 */
export const ROLE_GRANTS: Readonly<Record<RoleEnum, readonly Permission[]>> = {
    [RoleEnum.OWNER]: ALL_PERMISSIONS,
    [RoleEnum.ADMIN]: withoutNamespaces('billing').filter((permission) => permission !== 'tenants:delete'),
    [RoleEnum.OPERATOR]: [
        'campaigns:read',
        'campaigns:write',
        'campaigns:activate',
        'campaigns:pause',
        'campaigns:complete',
        'variants:read',
        'variants:write',
        'segments:read',
        'segments:write',
        'referrers:read',
        'referrers:write',
        'referrals:read',
        'referrals:reject',
        'rewards:read',
        'rewards:approve',
        'rewards:reject',
        'analytics:read',
        'tenants:read'
    ],
    [RoleEnum.VIEWER]: ['programs:read', 'campaigns:read', 'variants:read', 'referrals:read', 'rewards:read', 'analytics:read', 'tenants:read'],
    /**
     * Support Agent. v5: "Read on referrers/referrals/rewards; limited write — rewards:adjust,
     * rewards:resend_email, referrers:note — all live Keto + audit trail." The three writes are in
     * LIVE_CHECK_PERMISSIONS below, so none of them can be authorized from a stale JWT snapshot.
     */
    [RoleEnum.SUPPORT]: [
        'referrers:read',
        'referrers:note',
        'referrals:read',
        'rewards:read',
        'rewards:adjust',
        'rewards:resend_email',
        'analytics:read',
        'tenants:read'
    ]
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
    // v5 §2 adds `adjust` to the live-checked set, and the Support Agent row marks its three writes
    // "all live Keto + audit trail" — a support annotation or a resent reward email must not be
    // authorized by a token issued before the agent's access was revoked.
    'rewards:adjust',
    'rewards:resend_email',
    'referrers:note',
    'payouts:write',
    'payouts:confirm',
    'api_keys:manage',
    'users:write',
    'billing:write',
    'tenants:delete'
]);

/** Role hierarchy used to stop a principal granting a role above their own. */
export const ROLE_RANK: Readonly<Record<RoleEnum, number>> = {
    [RoleEnum.OWNER]: 5,
    [RoleEnum.ADMIN]: 4,
    [RoleEnum.OPERATOR]: 3,
    // Above Viewer because Support can adjust a reward and resend its email, which Viewer cannot;
    // below Operator because it cannot approve one. Only the ordering is used, never the numbers.
    [RoleEnum.SUPPORT]: 2,
    [RoleEnum.VIEWER]: 1
};

export function splitPermission(permission: Permission): { namespace: PermissionNamespace; relation: string } {
    const [namespace, relation] = permission.split(':') as [PermissionNamespace, string];
    return { namespace, relation };
}
