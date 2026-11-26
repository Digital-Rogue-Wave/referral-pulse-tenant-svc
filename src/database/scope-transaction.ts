import type { Prisma } from '@prisma-gen/generated/client';

/**
 * Re-scopes a transaction that has just created a tenant to that tenant (v5.2 DB Model §0.8): the request had no tenant
 * when the transaction began, and the rows it writes next (the Owner, the outbox, the audit trail) belong to the new one.
 * The setting is transaction-local, and row-level security still binds the writes — to this tenant only.
 */
export async function scopeTransactionToTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}
