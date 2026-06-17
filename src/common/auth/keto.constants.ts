export const KETO_PERMISSION_KEY = 'keto_permission';

// ─── Shared across all microservices (common/auth) ───────────────────────────

export enum KetoNamespace {
    ROLE = 'role',
    TENANT = 'tenants'
}

/**
 * Universal CRUD actions on resources.
 *
 *   CREATE = write = invite = ingest
 *   READ   = list = view
 */
export enum KetoRelation {
    CREATE = 'create',
    READ = 'read',
    UPDATE = 'update',
    DELETE = 'delete'
}

/** Role namespace relation: role:admin#assigned@user:123 */
export const ROLE_ASSIGNMENT = 'assigned' as const;

// ─── tenant-svc resources (each microservice defines its own) ────────────────

export enum KetoResource {
    MEMBER = 'member',
    INVITATION = 'invitation',
    API_KEY = 'api_key',
    BILLING = 'billing',
    PLANS = 'plans',
    SETTINGS = 'settings'
}
