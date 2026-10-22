/**
 * Platform operator roles.
 *
 * API Contract §2 "Role → Permission Mapping" names four **standard** roles — `owner`,
 * `operator`, `viewer`, `support` — mapped to the Product Spec §4 actors Owner, Campaign Manager,
 * Analyst and Support Agent.
 *
 * There is no fifth. R-ACT-01: "There are exactly five internal roles ... No other role exists;
 * 'Program Admin', 'Account Owner', 'Marketer/Operator' and 'Viewer' are retired names for the same
 * four tenant roles." `ADMIN` was the retired Program Admin, kept as a custom role under decision
 * T-1 because ownership transfer demoted the outgoing Owner to it; that path now demotes to
 * `OPERATOR` and the role is gone (NOTE.md §V5.21). The fifth role R-ACT-01 names is platform-side
 * Super Admin, which is a Keto relation (`KETO_PLATFORM_ADMIN_RELATION`), not a tenant membership.
 */
export enum RoleEnum {
    OWNER = 'OWNER',
    OPERATOR = 'OPERATOR',
    SUPPORT = 'SUPPORT',
    VIEWER = 'VIEWER'
}

/** The four v5 standard roles. `roles.tenant_id` is null for exactly these (DB Model §3). */
export const STANDARD_ROLES: readonly RoleEnum[] = [RoleEnum.OWNER, RoleEnum.OPERATOR, RoleEnum.VIEWER, RoleEnum.SUPPORT];

/** Product Spec §4 actor names, for dashboards and audit entries. */
export const ROLE_DISPLAY_NAMES: Readonly<Record<RoleEnum, string>> = {
    [RoleEnum.OWNER]: 'Owner',
    [RoleEnum.OPERATOR]: 'Campaign Manager',
    [RoleEnum.SUPPORT]: 'Support Agent',
    [RoleEnum.VIEWER]: 'Analyst'
};
