export enum KetoNamespace {
    ROLE = 'role',
    TENANT = 'tenants',
    EVENT = 'event'
}

export enum KetoRelation {
    MEMBER = 'member',
    WRITE = 'write',
    READ = 'read',
    CREATE_API_KEY = 'create_api_key',
    UPDATE_API_KEY = 'update_api_key',
    DELETE_API_KEY = 'delete_api_key',
    LIST_API_KEY = 'list_api_key',
    MANAGE_BILLING = 'manage_billing',
    MANAGE_PLANS = 'manage_plans'
}

export enum KetoPermission {
    CREATE = 'create',
    READ = 'read',
    UPDATE = 'update',
    DELETE = 'delete',
    INGEST = 'ingest',
    VIEW = 'view',
    INVITE = 'invite'
}
