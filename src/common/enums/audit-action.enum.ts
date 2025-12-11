export enum AuditAction {
    // Tenant actions
    TENANT_CREATED = 'tenant.created',
    TENANT_UPDATED = 'tenant.updated',
    TENANT_DELETED = 'tenant.deleted',
    TENANT_SUSPENDED = 'tenant.suspended',
    TENANT_UNSUSPENDED = 'tenant.unsuspended',

    // Team member actions
    MEMBER_INVITED = 'member.invited',
    MEMBER_JOINED = 'member.joined',
    MEMBER_ROLE_UPDATED = 'member.role_updated',
    MEMBER_REMOVED = 'member.removed',

    // Settings actions
    SETTINGS_UPDATED = 'settings.updated',
    LOGO_UPLOADED = 'logo.uploaded',

    // API key actions
    API_KEY_CREATED = 'api_key.created',
    API_KEY_UPDATED = 'api_key.updated',
    API_KEY_STOPPED = 'api_key.stopped',
    API_KEY_REVOKED = 'api_key.revoked',
    API_KEY_DELETED = 'api_key.deleted',

    // Billing actions
    SUBSCRIPTION_CREATED = 'subscription.created',
    SUBSCRIPTION_UPDATED = 'subscription.updated',
    SUBSCRIPTION_CANCELLED = 'subscription.cancelled',
    PAYMENT_METHOD_UPDATED = 'payment_method.updated',

    // Ownership actions
    OWNERSHIP_TRANSFERRED = 'ownership.transferred'
}
