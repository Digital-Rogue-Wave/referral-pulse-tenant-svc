import type { ClsStore } from 'nestjs-cls';

export type ClsRequestContext = ClsStore & {
    // seeded by interceptor/guards
    requestId: string;
    tenantId: string;
    userId: string;

    // optional request metadata
    idempotencyKey?: string;
    ip?: string;
    userAgent?: string;
    route?: string;

    // per-tenant privacy flags (set in auth middleware)
    piiHashing?: boolean;
    piiSalt?: string | null;

    // extra flags/metadata you set in middleware
    requireHmac?: boolean;
    publishableKey?: string;
};
