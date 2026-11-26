/**
 * Database Fixture Helpers for BDD Tests
 *
 * Creates short-lived tenant rows for scenarios that need specific tenant states
 * (suspended, locked, active). Each fixture is created in a Before hook and
 * deleted in the matching After hook so the dev database stays clean.
 *
 * Fixture IDs are prefixed with "bdd-" to make them easy to identify.
 */

import { createHash } from 'crypto';
import pg from 'pg';
import { Prisma, PrismaClient, type Billing, type TenantSetting } from '../../../src/prisma/generated/client';
import { PrismaPg } from '@prisma/adapter-pg';

// ─── Singleton client ──────────────────────────────────────────────────────────

// Fixtures seed and inspect every tenant's rows, so they connect as the privileged role (v5.2 DB Model 0.8).
const connectionString = process.env.DATABASE_PRIVILEGED_URL ?? 'postgresql://root:root@localhost:5432/tenants';

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);

export const fixturesPrisma = new PrismaClient({ adapter });

/**
 * Deletes the BDD tenants' audit rows. `audit_log` is append-only in the database (US1.9.1 F3): a delete
 * passes only in a transaction that opts in, as the retention sweeper does.
 */
export async function purgeAuditRows(tenantIds: string[]): Promise<void> {
    await fixturesPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.audit_purge', 'on', true)`;
        await tx.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    });
}

/** Delete only the named audit rows, so a shared tenant's pre-existing trail is never removed. */
export async function purgeAuditRowsByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await fixturesPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.audit_purge', 'on', true)`;
        await tx.auditLog.deleteMany({ where: { id: { in: ids } } });
    });
}

// ─── Fixture IDs ───────────────────────────────────────────────────────────────

export const FIXTURE_IDS = {
    suspended: 'bdd-suspended-001',
    locked: 'bdd-locked-001',
    active: 'bdd-active-001'
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function createSuspendedTenant(id: string): Promise<void> {
    await fixturesPrisma.tenant.upsert({
        where: { id },
        update: { status: 'suspended', paymentStatus: 'active' },
        create: {
            id,
            name: `BDD Suspended Tenant (${id})`,
            slug: id,
            status: 'suspended',
            paymentStatus: 'active'
        }
    });

    await fixturesPrisma.billing.upsert({
        where: { tenantId: id },
        update: {},
        create: { tenantId: id, plan: 'Free', status: 'none' }
    });
}

export async function createLockedTenant(id: string): Promise<void> {
    const now = new Date();

    await fixturesPrisma.tenant.upsert({
        where: { id },
        update: {
            status: 'locked',
            paymentStatus: 'active',
            lockedAt: now,
            lockReason: 'bdd-test'
        },
        create: {
            id,
            name: `BDD Locked Tenant (${id})`,
            slug: id,
            status: 'locked',
            paymentStatus: 'active',
            lockedAt: now,
            lockReason: 'bdd-test'
        }
    });

    await fixturesPrisma.billing.upsert({
        where: { tenantId: id },
        update: {},
        create: { tenantId: id, plan: 'Free', status: 'none' }
    });
}

export async function createActiveTenant(id: string): Promise<void> {
    await fixturesPrisma.tenant.upsert({
        where: { id },
        update: { status: 'active', paymentStatus: 'active' },
        create: {
            id,
            name: `BDD Active Tenant (${id})`,
            slug: id,
            status: 'active',
            paymentStatus: 'active'
        }
    });

    await fixturesPrisma.billing.upsert({
        where: { tenantId: id },
        update: {},
        create: { tenantId: id, plan: 'Free', status: 'none' }
    });
}

/** Give an existing tenant an active paid subscription (for upgrade/preview flows). */
export async function setActiveSubscription(tenantId: string): Promise<void> {
    await fixturesPrisma.billing.upsert({
        where: { tenantId },
        update: {
            plan: 'Starter',
            status: 'active',
            stripeCustomerId: 'cus_bdd_active',
            stripeSubscriptionId: 'sub_bdd_active'
        },
        create: {
            tenantId,
            plan: 'Starter',
            status: 'active',
            stripeCustomerId: 'cus_bdd_active',
            stripeSubscriptionId: 'sub_bdd_active'
        }
    });
}

export async function clearInvitationsByEmails(tenantId: string, emails: string[]): Promise<void> {
    if (emails.length === 0) return;
    await fixturesPrisma.invitation.deleteMany({ where: { tenantId, email: { in: emails } } });
}

export async function clearApiKeysByCreator(tenantId: string, createdBy: string): Promise<void> {
    await fixturesPrisma.apiKey.deleteMany({ where: { tenantId, createdBy } });
}

export async function clearBddStripeEvents(): Promise<void> {
    await fixturesPrisma.stripeEvent.deleteMany({ where: { id: { startsWith: 'evt_bdd_' } } });
}

export async function seedPendingInvitation(params: { tenantId: string; email: string; token: string; role: string }): Promise<void> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tokenHash = sha256(params.token);
    await fixturesPrisma.invitation.upsert({
        where: { tokenHash },
        update: { tenantId: params.tenantId, email: params.email, role: params.role, status: 'pending', expiresAt, deletedAt: null },
        create: { tenantId: params.tenantId, email: params.email, role: params.role, status: 'pending', tokenHash, expiresAt }
    });
}

/** Remove an invitation + any membership its acceptance created, so the accept flow re-runs cleanly. */
export async function cleanupInvitationFlow(params: { tenantId: string; token: string; kratosIdentityId: string }): Promise<void> {
    const users = await fixturesPrisma.user.findMany({ where: { kratosIdentityId: params.kratosIdentityId } }).catch(() => [] as { id: string }[]);
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
        await fixturesPrisma.userRole.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
        await fixturesPrisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
    }
    await fixturesPrisma.invitation.deleteMany({ where: { tokenHash: sha256(params.token) } }).catch(() => undefined);
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Seed (idempotently) a member of the tenant — the acting user of membership-aware routes. */
export async function ensureMember(params: {
    tenantId: string;
    userId: string;
    kratosIdentityId: string;
    email: string;
    role: string;
}): Promise<void> {
    const role = await fixturesPrisma.role.findUnique({ where: { name: params.role }, select: { id: true } });
    const data = {
        tenantId: params.tenantId,
        kratosIdentityId: params.kratosIdentityId,
        email: params.email,
        emailHash: sha256(params.email.toLowerCase()),
        role: params.role,
        deletedAt: null
    };
    await fixturesPrisma.user.upsert({ where: { id: params.userId }, update: data, create: { id: params.userId, ...data } });
    if (role) {
        await fixturesPrisma.userRole.upsert({
            where: { userId_roleId: { userId: params.userId, roleId: role.id } },
            update: {},
            create: { userId: params.userId, roleId: role.id, tenantId: params.tenantId }
        });
    }
}

export async function clearIdempotencyKeys(tenantId: string): Promise<void> {
    await fixturesPrisma.idempotencyKey.deleteMany({ where: { tenantId } });
}

/** Remove only BDD-owned idempotency keys, never a caller's baseline key. */
export async function clearBddIdempotencyKeys(tenantId: string): Promise<void> {
    await fixturesPrisma.idempotencyKey.deleteMany({
        where: { tenantId, idempotencyKey: { startsWith: 'bdd-' } }
    });
}

export interface TenantStateSnapshot {
    billing: Billing | null;
    tenantSetting: TenantSetting | null;
    apiKeyIds: string[];
    invitationIds: string[];
    billingEventIds: string[];
    tenantUsageIds: string[];
    usageCounterKeys: Array<{ tenantId: string; metric: string; period: string }>;
    stripeEventIds: string[];
    auditLogIds: string[];
    eventOutboxIds: string[];
    sideEffectOutboxIds: string[];
    idempotencyKeys: Array<{ tenantId: string; idempotencyKey: string }>;
}

/** Capture the shared tenant's baseline so a scenario can restore it exactly afterwards. */
export async function captureTenantState(tenantId: string, apiKeyCreator: string): Promise<TenantStateSnapshot> {
    const [
        billing,
        tenantSetting,
        apiKeys,
        invitations,
        billingEvents,
        tenantUsages,
        usageCounters,
        stripeEvents,
        auditRows,
        eventOutbox,
        sideEffectOutbox,
        idempotencyKeys
    ] = await Promise.all([
        fixturesPrisma.billing.findUnique({ where: { tenantId } }),
        fixturesPrisma.tenantSetting.findUnique({ where: { tenantId } }),
        fixturesPrisma.apiKey.findMany({ where: { tenantId, createdBy: apiKeyCreator }, select: { id: true } }),
        fixturesPrisma.invitation.findMany({ where: { tenantId }, select: { id: true } }),
        fixturesPrisma.billingEvent.findMany({ where: { tenantId }, select: { id: true } }),
        fixturesPrisma.tenantUsage.findMany({ where: { tenantId }, select: { id: true } }),
        fixturesPrisma.usageCounter.findMany({
            where: { tenantId },
            select: { tenantId: true, metric: true, period: true }
        }),
        fixturesPrisma.stripeEvent.findMany({ where: { id: { startsWith: 'evt_bdd_' } }, select: { id: true } }),
        fixturesPrisma.auditLog.findMany({ where: { tenantId }, select: { id: true } }),
        fixturesPrisma.eventOutbox.findMany({ where: { tenantId }, select: { id: true } }),
        fixturesPrisma.sideEffectOutbox.findMany({ where: { tenantId }, select: { id: true } }),
        fixturesPrisma.idempotencyKey.findMany({
            where: { tenantId, idempotencyKey: { startsWith: 'bdd-' } },
            select: { tenantId: true, idempotencyKey: true }
        })
    ]);

    return {
        billing,
        tenantSetting,
        apiKeyIds: apiKeys.map((row) => row.id),
        invitationIds: invitations.map((row) => row.id),
        billingEventIds: billingEvents.map((row) => row.id),
        tenantUsageIds: tenantUsages.map((row) => row.id),
        usageCounterKeys: usageCounters,
        stripeEventIds: stripeEvents.map((row) => row.id),
        auditLogIds: auditRows.map((row) => row.id),
        eventOutboxIds: eventOutbox.map((row) => row.id),
        sideEffectOutboxIds: sideEffectOutbox.map((row) => row.id),
        idempotencyKeys
    };
}

async function restoreBilling(tenantId: string, billing: Billing | null): Promise<void> {
    if (!billing) {
        await fixturesPrisma.billing.deleteMany({ where: { tenantId } });
        return;
    }

    await fixturesPrisma.billing.upsert({
        where: { tenantId },
        update: {
            plan: billing.plan,
            status: billing.status,
            stripeCustomerId: billing.stripeCustomerId,
            stripeSubscriptionId: billing.stripeSubscriptionId,
            stripeTransactionId: billing.stripeTransactionId,
            pendingDowngradePlan: billing.pendingDowngradePlan,
            downgradeScheduledAt: billing.downgradeScheduledAt,
            cancellationReason: billing.cancellationReason,
            cancellationRequestedAt: billing.cancellationRequestedAt,
            cancellationEffectiveAt: billing.cancellationEffectiveAt,
            lastStripeEventAt: billing.lastStripeEventAt,
            deletedAt: billing.deletedAt,
            updatedAt: billing.updatedAt
        },
        create: {
            id: billing.id,
            tenantId: billing.tenantId,
            plan: billing.plan,
            status: billing.status,
            stripeCustomerId: billing.stripeCustomerId,
            stripeSubscriptionId: billing.stripeSubscriptionId,
            stripeTransactionId: billing.stripeTransactionId,
            pendingDowngradePlan: billing.pendingDowngradePlan,
            downgradeScheduledAt: billing.downgradeScheduledAt,
            cancellationReason: billing.cancellationReason,
            cancellationRequestedAt: billing.cancellationRequestedAt,
            cancellationEffectiveAt: billing.cancellationEffectiveAt,
            lastStripeEventAt: billing.lastStripeEventAt,
            deletedAt: billing.deletedAt,
            createdAt: billing.createdAt,
            updatedAt: billing.updatedAt
        }
    });
}

async function restoreTenantSetting(tenantId: string, setting: TenantSetting | null): Promise<void> {
    if (!setting) {
        await fixturesPrisma.tenantSetting.deleteMany({ where: { tenantId } });
        return;
    }

    await fixturesPrisma.tenantSetting.upsert({
        where: { tenantId },
        update: {
            branding: setting.branding as Prisma.InputJsonValue,
            notifications: setting.notifications as Prisma.InputJsonValue,
            general: setting.general as Prisma.InputJsonValue,
            currencyCode: setting.currencyCode,
            deletedAt: setting.deletedAt,
            updatedAt: setting.updatedAt
        },
        create: {
            id: setting.id,
            tenantId: setting.tenantId,
            branding: setting.branding as Prisma.InputJsonValue,
            notifications: setting.notifications as Prisma.InputJsonValue,
            general: setting.general as Prisma.InputJsonValue,
            currencyCode: setting.currencyCode,
            deletedAt: setting.deletedAt,
            createdAt: setting.createdAt,
            updatedAt: setting.updatedAt
        }
    });
}

/** Remove rows created by a scenario and restore mutable singleton rows to their captured values. */
export async function restoreTenantState(tenantId: string, snapshot: TenantStateSnapshot, apiKeyCreator: string): Promise<void> {
    const [
        apiKeys,
        invitations,
        billingEvents,
        tenantUsages,
        usageCounters,
        stripeEvents,
        auditRows,
        eventOutbox,
        sideEffectOutbox,
        idempotencyKeys
    ] = await Promise.all([
        fixturesPrisma.apiKey.findMany({ where: { tenantId, createdBy: apiKeyCreator }, select: { id: true } }),
        fixturesPrisma.invitation.findMany({ where: { tenantId }, select: { id: true } }),
        fixturesPrisma.billingEvent.findMany({ where: { tenantId }, select: { id: true } }),
        fixturesPrisma.tenantUsage.findMany({ where: { tenantId }, select: { id: true } }),
        fixturesPrisma.usageCounter.findMany({
            where: { tenantId },
            select: { tenantId: true, metric: true, period: true }
        }),
        fixturesPrisma.stripeEvent.findMany({ where: { id: { startsWith: 'evt_bdd_' } }, select: { id: true } }),
        fixturesPrisma.auditLog.findMany({ where: { tenantId }, select: { id: true } }),
        fixturesPrisma.eventOutbox.findMany({ where: { tenantId }, select: { id: true } }),
        fixturesPrisma.sideEffectOutbox.findMany({ where: { tenantId }, select: { id: true } }),
        fixturesPrisma.idempotencyKey.findMany({
            where: { tenantId, idempotencyKey: { startsWith: 'bdd-' } },
            select: { tenantId: true, idempotencyKey: true }
        })
    ]);

    const added = (current: string[], baseline: string[]): string[] => {
        const known = new Set(baseline);
        return current.filter((id) => !known.has(id));
    };
    const addedApiKeyIds = added(
        apiKeys.map((row) => row.id),
        snapshot.apiKeyIds
    );
    const addedInvitationIds = added(
        invitations.map((row) => row.id),
        snapshot.invitationIds
    );
    const addedBillingEventIds = added(
        billingEvents.map((row) => row.id),
        snapshot.billingEventIds
    );
    const addedTenantUsageIds = added(
        tenantUsages.map((row) => row.id),
        snapshot.tenantUsageIds
    );
    const addedStripeEventIds = added(
        stripeEvents.map((row) => row.id),
        snapshot.stripeEventIds
    );
    const addedAuditRowIds = added(
        auditRows.map((row) => row.id),
        snapshot.auditLogIds
    );
    const addedEventOutboxIds = added(
        eventOutbox.map((row) => row.id),
        snapshot.eventOutboxIds
    );
    const addedSideEffectOutboxIds = added(
        sideEffectOutbox.map((row) => row.id),
        snapshot.sideEffectOutboxIds
    );

    const usageCounterKey = (row: { tenantId: string; metric: string; period: string }): string => `${row.tenantId}\0${row.metric}\0${row.period}`;
    const baselineUsageCounters = new Set(snapshot.usageCounterKeys.map(usageCounterKey));
    const addedUsageCounters = usageCounters.filter((row) => !baselineUsageCounters.has(usageCounterKey(row)));
    const idempotencyKey = (row: { tenantId: string; idempotencyKey: string }): string => `${row.tenantId}\0${row.idempotencyKey}`;
    const baselineIdempotencyKeys = new Set(snapshot.idempotencyKeys.map(idempotencyKey));
    const addedIdempotencyKeys = idempotencyKeys.filter((row) => !baselineIdempotencyKeys.has(idempotencyKey(row)));

    if (addedApiKeyIds.length) await fixturesPrisma.apiKey.deleteMany({ where: { id: { in: addedApiKeyIds } } });
    if (addedInvitationIds.length) await fixturesPrisma.invitation.deleteMany({ where: { id: { in: addedInvitationIds } } });
    if (addedBillingEventIds.length) await fixturesPrisma.billingEvent.deleteMany({ where: { id: { in: addedBillingEventIds } } });
    if (addedTenantUsageIds.length) await fixturesPrisma.tenantUsage.deleteMany({ where: { id: { in: addedTenantUsageIds } } });
    if (addedUsageCounters.length) {
        await fixturesPrisma.usageCounter.deleteMany({
            where: {
                OR: addedUsageCounters.map((row) => ({
                    tenantId: row.tenantId,
                    metric: row.metric,
                    period: row.period
                }))
            }
        });
    }
    if (addedIdempotencyKeys.length) {
        await fixturesPrisma.idempotencyKey.deleteMany({
            where: {
                OR: addedIdempotencyKeys.map((row) => ({
                    tenantId: row.tenantId,
                    idempotencyKey: row.idempotencyKey
                }))
            }
        });
    }
    if (addedEventOutboxIds.length) {
        await fixturesPrisma.eventOutbox.deleteMany({ where: { id: { in: addedEventOutboxIds } } });
    }
    if (addedSideEffectOutboxIds.length) {
        await fixturesPrisma.sideEffectOutbox.deleteMany({ where: { id: { in: addedSideEffectOutboxIds } } });
    }
    if (addedStripeEventIds.length) {
        await fixturesPrisma.stripeEvent.deleteMany({ where: { id: { in: addedStripeEventIds } } });
    }
    await purgeAuditRowsByIds(addedAuditRowIds);
    await restoreTenantSetting(tenantId, snapshot.tenantSetting);
    await restoreBilling(tenantId, snapshot.billing);
}

export async function cleanupTenant(id: string): Promise<void> {
    // These tables either have no tenant FK or carry tenant state that must not survive the fixture.
    await fixturesPrisma.sideEffectOutbox.deleteMany({ where: { tenantId: id } });
    await fixturesPrisma.eventOutbox.deleteMany({ where: { tenantId: id } });
    await clearIdempotencyKeys(id);
    await purgeAuditRows([id]);
    await fixturesPrisma.billingEvent.deleteMany({ where: { tenantId: id } });
    await fixturesPrisma.tenantUsage.deleteMany({ where: { tenantId: id } });
    await fixturesPrisma.usageCounter.deleteMany({ where: { tenantId: id } });
    await fixturesPrisma.billing.deleteMany({ where: { tenantId: id } });
    await fixturesPrisma.tenantSetting.deleteMany({ where: { tenantId: id } });
    await fixturesPrisma.invitation.deleteMany({ where: { tenantId: id } });
    await fixturesPrisma.apiKey.deleteMany({ where: { tenantId: id } });
    await fixturesPrisma.tenant.deleteMany({ where: { id } });
}

export async function disconnectFixturesPrisma(): Promise<void> {
    await fixturesPrisma.$disconnect();
    await pool.end();
}
