export const TENANT_DELETION_QUEUE = 'tenant-deletion';

export interface TenantDeletionJobData {
    tenantId: string;
    scheduledAt: string;
    executionDate: string;
    reason?: string;
}
