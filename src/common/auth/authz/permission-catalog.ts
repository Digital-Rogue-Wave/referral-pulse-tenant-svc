import { createHash } from 'crypto';

import { RoleEnum } from '@common/enums/role.enum';

/**
 * The platform permission catalog — Product Spec v5.1 §4 "Permission Catalogue" and "Permission to Check
 * per Method" (API Contract §2).
 *
 * tenant-service owns Ory Keto, so this file is the single definition of every namespace/relation the
 * platform checks, which role grants what, and which permissions must never be trusted from the JWT
 * `perms` snapshot. The tuple writer, the `perms` resolver and the guards all read from here, so they
 * cannot drift apart.
 *
 * The first eleven namespaces are v5.1's catalogue, verbatim. `tenants`, `users`, `billing` and `audit`
 * are tenant-service's own resources, which the catalogue does not cover (NOTE.md). `analytics:query` is
 * v5.1's "dedicated permission" for plain-English analytics; `analytics:write` covers analytics-svc's
 * write routes — neither has a row in the catalogue table, so their grants are E1 decision D2, to discuss.
 */
export const PERMISSION_CATALOG = {
    programs: ['read', 'write', 'archive'],
    campaigns: ['read', 'write', 'activate', 'pause', 'complete'],
    variants: ['read', 'write'],
    segments: ['read', 'write', 'delete'],
    participants: ['read', 'write', 'block', 'review', 'ban', 'note'],
    referrals: ['read', 'reject'],
    rewards: ['read', 'approve', 'reject', 'clawback', 'adjust', 'resend_email'],
    payouts: ['read', 'write', 'confirm', 'cancel'],
    analytics: ['read', 'write', 'query'],
    webhooks: ['read', 'write', 'delete'],
    api_keys: ['manage'],
    tenants: ['read', 'write', 'delete'],
    users: ['read', 'write'],
    billing: ['read', 'write'],
    audit: ['read']
} as const;

/**
 * Namespaces an earlier catalogue wrote and v5.1 retired: `referrers` became `participants`; `dsr` and
 * `connections` were tenant-service's own and now use the catalogue's `programs:write` and
 * `api_keys:manage` (E1 decision D16). Read only by the one-off v5.1 Keto re-provisioning, which deletes
 * their tuples before the namespaces leave the Keto configuration.
 */
export const RETIRED_NAMESPACES = ['referrers', 'dsr', 'connections'] as const;

export type PermissionNamespace = keyof typeof PERMISSION_CATALOG;
export type Permission = {
    [N in PermissionNamespace]: `${N}:${(typeof PERMISSION_CATALOG)[N][number]}`;
}[PermissionNamespace];

export const ALL_PERMISSIONS: readonly Permission[] = (Object.keys(PERMISSION_CATALOG) as PermissionNamespace[]).flatMap((namespace) =>
    PERMISSION_CATALOG[namespace].map((relation) => `${namespace}:${relation}` as Permission)
);

/**
 * Role → permission grants: v5.1 §4's catalogue table, column by column. Operator, Viewer and Support
 * additionally read their own tenant profile, which the dashboard needs on every page. Four roles, no
 * more (R-ACT-01, NOTE.md §V5.21).
 */
export const ROLE_GRANTS: Readonly<Record<RoleEnum, readonly Permission[]>> = {
    [RoleEnum.OWNER]: ALL_PERMISSIONS,
    /** Campaign Manager. */
    [RoleEnum.OPERATOR]: [
        'programs:read',
        'campaigns:read',
        'campaigns:write',
        'campaigns:activate',
        'campaigns:pause',
        'campaigns:complete',
        'variants:read',
        'variants:write',
        'segments:read',
        'segments:write',
        'participants:read',
        'participants:write',
        'participants:block',
        'participants:review',
        'referrals:read',
        'referrals:reject',
        'rewards:read',
        'rewards:approve',
        'rewards:reject',
        'payouts:read',
        'payouts:write',
        'payouts:confirm',
        'analytics:read',
        'analytics:write',
        'analytics:query',
        'tenants:read'
    ],
    /** Analyst — strictly read-only (R-ACT-03); `analytics:query` asks read-only questions. */
    [RoleEnum.VIEWER]: [
        'programs:read',
        'campaigns:read',
        'variants:read',
        'referrals:read',
        'rewards:read',
        'payouts:read',
        'analytics:read',
        'analytics:query',
        'tenants:read'
    ],
    /** Support Agent (R-ACT-04): reads, plus three live-checked, audited writes. */
    [RoleEnum.SUPPORT]: [
        'participants:read',
        'participants:note',
        'referrals:read',
        'rewards:read',
        'rewards:adjust',
        'rewards:resend_email',
        'payouts:read',
        'analytics:read',
        'tenants:read'
    ]
};

/**
 * Permissions that are always re-checked against Keto live, never authorized from the JWT snapshot:
 * every `live` row of v5.1 §4 "Permission to Check per Method" (R-ACT-05), plus — for this service —
 * role changes, billing changes and tenant deletion, where a stale token must not win.
 */
export const LIVE_CHECK_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
    'participants:ban',
    'participants:note',
    'rewards:approve',
    'rewards:reject',
    'rewards:clawback',
    'rewards:adjust',
    'rewards:resend_email',
    'payouts:write',
    'payouts:confirm',
    'payouts:cancel',
    // Also the Connection routes' permission (v5.1 §4), live: a connection decides whose webhooks count as money.
    'api_keys:manage',
    'users:write',
    'billing:write',
    'tenants:delete'
]);

/**
 * A fingerprint of the role → permission grants. The worker re-provisions every tenant once when it
 * changes (KetoReconcilerWorker), so a catalogue change reaches existing tenants on the next deploy
 * without a manual step.
 */
export const CATALOG_VERSION = createHash('sha256').update(JSON.stringify(ROLE_GRANTS)).digest('hex').slice(0, 16);

/** Role hierarchy used to stop a principal granting a role above their own. */
export const ROLE_RANK: Readonly<Record<RoleEnum, number>> = {
    [RoleEnum.OWNER]: 5,
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
