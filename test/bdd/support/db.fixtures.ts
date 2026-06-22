/**
 * Database Fixture Helpers for BDD Tests
 *
 * Creates short-lived tenant rows for scenarios that need specific tenant states
 * (suspended, locked, active). Each fixture is created in a Before hook and
 * deleted in the matching After hook so the dev database stays clean.
 *
 * Fixture IDs are prefixed with "bdd-" to make them easy to identify.
 */

import pg from 'pg';
import { PrismaClient } from '../../../src/prisma/generated/client';
import { PrismaPg } from '@prisma/adapter-pg';

// ─── Singleton client ──────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL ?? 'postgresql://root:root@localhost:5432/tenants';

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);

export const fixturesPrisma = new PrismaClient({ adapter });

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

/** Reset a tenant's billing back to the default Free / no-subscription state. */
export async function clearSubscription(tenantId: string): Promise<void> {
    await fixturesPrisma.billing
        .updateMany({
            where: { tenantId },
            data: { plan: 'Free', status: 'none', stripeCustomerId: null, stripeSubscriptionId: null }
        })
        .catch(() => undefined);
}

export async function clearInvitations(tenantId: string): Promise<void> {
    await fixturesPrisma.invitation.deleteMany({ where: { tenantId } }).catch(() => undefined);
}

export async function cleanupTenant(id: string): Promise<void> {
    // Delete billing first (FK constraint)
    await fixturesPrisma.billing.deleteMany({ where: { tenantId: id } }).catch(() => undefined);
    await fixturesPrisma.tenant.deleteMany({ where: { id } }).catch(() => undefined);
}

export async function disconnectFixturesPrisma(): Promise<void> {
    await fixturesPrisma.$disconnect();
    await pool.end();
}
