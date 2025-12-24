export const TENANT_UNLOCK_QUEUE = 'tenant-unlock';

export interface TenantUnlockJobData {
    tenantId: string;
    lockUntil: string;
}
