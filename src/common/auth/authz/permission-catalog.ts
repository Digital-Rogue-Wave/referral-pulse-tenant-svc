import { createHash } from 'crypto';

import { RoleEnum } from '@common/enums/role.enum';

/**
 * The platform permission catalog — Product Spec v5.2 §4 "Permission Catalogue" and "Permission to Check
 * per Method" (API Contract v5.2 §2, Appendix A #89).
 *
 * tenant-service owns Ory Keto, so this file is the single definition of every namespace/relation the
 * platform checks, which role grants what, and which permissions must never be trusted from the JWT
 * `perms` snapshot. The tuple writer, the `perms` resolver and the guards all read from here, so they
 * cannot drift apart. v5.2 has thirteen namespaces and this file holds exactly those.
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
    analytics: ['read', 'query'],
    webhooks: ['read', 'write', 'delete'],
    // Also gates Connections and the widget signing secret (v5.2 §4).
    api_keys: ['manage'],
    users: ['read', 'manage'],
    // Tenant settings and company verification (`settings`), platform billing (`billing`).
    tenant: ['read', 'settings', 'billing']
} as const;

/**
 * Namespaces an earlier catalogue wrote and the current one retired: `referrers` became `participants`;
 * `dsr` and `connections` use `programs:write` and `api_keys:manage` (E1 D16); v5.2 folded `tenants`,
 * `billing` and `audit` into the one `tenant` namespace. Read only by the one-off Keto re-provisioning,
 * which deletes their tuples before the namespaces leave the Keto configuration.
 */
export const RETIRED_NAMESPACES = ['referrers', 'dsr', 'connections', 'tenants', 'billing', 'audit'] as const;

export type PermissionNamespace = keyof typeof PERMISSION_CATALOG;
export type Permission = {
    [N in PermissionNamespace]: `${N}:${(typeof PERMISSION_CATALOG)[N][number]}`;
}[PermissionNamespace];

export const ALL_PERMISSIONS: readonly Permission[] = (Object.keys(PERMISSION_CATALOG) as PermissionNamespace[]).flatMap((namespace) =>
    PERMISSION_CATALOG[namespace].map((relation) => `${namespace}:${relation}` as Permission)
);

/**
 * Role → permission grants: v5.2 §4's catalogue table, column by column, and nothing else. Four roles, no
 * more (R-ACT-01).
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
        'analytics:query',
        'webhooks:read'
    ],
    /** Analyst — strictly read-only (R-ACT-03): never `analytics:query`, never Connections. */
    [RoleEnum.VIEWER]: ['programs:read', 'campaigns:read', 'variants:read', 'referrals:read', 'rewards:read', 'payouts:read', 'analytics:read'],
    /** Support Agent (R-ACT-04): reads, plus three live-checked, audited writes. */
    [RoleEnum.SUPPORT]: [
        'participants:read',
        'participants:note',
        'referrals:read',
        'rewards:read',
        'rewards:adjust',
        'rewards:resend_email',
        'payouts:read',
        'analytics:read'
    ]
};

/**
 * Permissions that are always re-checked against Keto live, never authorized from the JWT snapshot:
 * every `live` row of v5.2 §4 "Permission to Check per Method" and API §3.16/§3.17 (R-ACT-05).
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
    // API keys, Connections and the widget signing secret.
    'api_keys:manage',
    'users:manage',
    'tenant:settings',
    // Live on every billing route: v5.2 marks the portal session live; the reads are re-checked too, so one
    // permission keeps one mode (not in spec — to discuss).
    'tenant:billing'
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
