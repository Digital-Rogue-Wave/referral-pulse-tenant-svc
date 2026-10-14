/**
 * Platform operator roles.
 *
 * API Contract v5 §2 "Role → Permission Mapping" names four **standard** roles — `owner`,
 * `operator`, `viewer`, `support` — mapped to the Product Spec §4 actors Owner, Campaign Manager,
 * Analyst and Support Agent.
 *
 * `ADMIN` is not one of them. It is kept as a **custom** role rather than removed: v5's own
 * `roles.name` CHECK is `('owner','operator','viewer','support') or custom`, and ownership transfer
 * demotes the outgoing owner to it, so deleting it would orphan live assignments and break that
 * path for no gain. See NOTE.md decision T-1.
 */
export enum RoleEnum {
    OWNER = 'OWNER',
    ADMIN = 'ADMIN',
    OPERATOR = 'OPERATOR',
    SUPPORT = 'SUPPORT',
    VIEWER = 'VIEWER'
}

/** The four v5 standard roles. `roles.tenant_id` is null for exactly these (DB Model v5 §3). */
export const STANDARD_ROLES: readonly RoleEnum[] = [RoleEnum.OWNER, RoleEnum.OPERATOR, RoleEnum.VIEWER, RoleEnum.SUPPORT];

/** Roles outside v5's standard set, carried for backwards compatibility. Tenant-scoped in `roles`. */
export const CUSTOM_ROLES: readonly RoleEnum[] = [RoleEnum.ADMIN];

/** Product Spec §4 actor names, for dashboards and audit entries. */
export const ROLE_DISPLAY_NAMES: Readonly<Record<RoleEnum, string>> = {
    [RoleEnum.OWNER]: 'Owner',
    [RoleEnum.ADMIN]: 'Admin',
    [RoleEnum.OPERATOR]: 'Campaign Manager',
    [RoleEnum.SUPPORT]: 'Support Agent',
    [RoleEnum.VIEWER]: 'Analyst'
};
