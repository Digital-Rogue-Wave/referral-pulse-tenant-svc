/**
 * Database Seed
 *
 * Populates baseline data required for the application to function and for
 * manual testing via Swagger:
 *
 *   1. Currencies       — USD, EUR (required by billing)
 *   2. Plans            — Free / Starter / Growth / Scale / Enterprise (public plans with Stripe IDs)
 *   2b. Roles          — keto_relations derived from ROLE_GRANTS (never hand-written)
 *   3. Test tenant      — id: AZP-772-OMEGA  (use this in the x-tenant-id / tenant-id header)
 *   4. Test billing row — Free plan, no Stripe customer yet
 *
 * Run:
 *   pnpm seed                 (uses ts-node)
 *   pnpm prisma migrate reset  (runs migrations + seed automatically)
 *
 * Swagger: http://localhost:3000/docs
 * Set "tenant-id" header to "AZP-772-OMEGA" in every request.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.development so Stripe price IDs are available
dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });
dotenv.config(); // fallback to .env

import { ROLE_GRANTS } from '../common/auth/authz/permission-catalog';
import { RoleEnum } from '../common/enums/role.enum';
import { PrismaClient } from './generated/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// ─── Constants ────────────────────────────────────────────────────────────────

/** The tenant ID used by the frontend for manual testing. */
const TEST_TENANT_ID = 'AZP-772-OMEGA';

/**
 * The tenant ID injected by Ory Hydra JWT tokens during local development.
 * AlsAuthInterceptor sets tenantId = user?.tenantId first, which always
 * resolves to this value when using the local Hydra dev token.
 */
const DEFAULT_TENANT_ID = 'default-tenant';

/** Stripe Price IDs — read from env so the seed works in all environments. */
const STRIPE_PRICE = {
    Free: process.env.STRIPE_FREE_PRICE_ID ?? '',
    Starter: process.env.STRIPE_STARTER_PRICE_ID ?? '',
    Growth: process.env.STRIPE_GROWTH_PRICE_ID ?? '',
    Scale: process.env.STRIPE_SCALE_PRICE_ID ?? '',
    Enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID ?? ''
};

/** Stripe Product IDs — optional, used for matching during sync. */
const STRIPE_PRODUCT = {
    Free: process.env.STRIPE_FREE_PRODUCT_ID ?? '',
    Starter: process.env.STRIPE_STARTER_PRODUCT_ID ?? '',
    Growth: process.env.STRIPE_GROWTH_PRODUCT_ID ?? '',
    Scale: process.env.STRIPE_SCALE_PRODUCT_ID ?? '',
    Enterprise: process.env.STRIPE_ENTERPRISE_PRODUCT_ID ?? ''
};

// ─── Setup ────────────────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
}

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Seed functions ───────────────────────────────────────────────────────────

async function seedCurrencies() {
    const usd = await prisma.currency.upsert({
        where: { code: 'USD' },
        update: {},
        create: { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 }
    });

    const eur = await prisma.currency.upsert({
        where: { code: 'EUR' },
        update: {},
        create: { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 }
    });

    console.log('✅ Currencies:', { usd: usd.code, eur: eur.code });
}

async function seedPlans() {
    const plans = [
        {
            name: 'Free',
            stripePriceId: STRIPE_PRICE.Free || null,
            stripeProductId: STRIPE_PRODUCT.Free || null,
            interval: null,
            isActive: true,
            manualInvoicing: false,
            limits: {
                campaigns: 3,
                referred_users: 100,
                seats: 2,
                leaderboard_entries: 100,
                email_sends: 500
            }
        },
        {
            name: 'Starter',
            stripePriceId: STRIPE_PRICE.Starter || null,
            stripeProductId: STRIPE_PRODUCT.Starter || null,
            interval: 'month',
            isActive: true,
            manualInvoicing: false,
            limits: {
                campaigns: 10,
                referred_users: 1_000,
                seats: 5,
                leaderboard_entries: 1_000,
                email_sends: 5_000
            }
        },
        {
            name: 'Growth',
            stripePriceId: STRIPE_PRICE.Growth || null,
            stripeProductId: STRIPE_PRODUCT.Growth || null,
            interval: 'month',
            isActive: true,
            manualInvoicing: false,
            limits: {
                campaigns: 50,
                referred_users: 10_000,
                seats: 15,
                leaderboard_entries: 10_000,
                email_sends: 50_000
            }
        },
        {
            // DB Model section 3 names a fifth tier between Growth and Enterprise. Seeded
            // INACTIVE on purpose: no document specifies its limits or price, and these numbers are
            // a dev placeholder interpolated on the existing progression, not a commercial
            // decision. Set real limits and flip isActive before offering it.
            name: 'Scale',
            stripePriceId: STRIPE_PRICE.Scale || null,
            stripeProductId: STRIPE_PRODUCT.Scale || null,
            interval: 'month',
            isActive: false,
            manualInvoicing: false,
            limits: {
                campaigns: 150,
                referred_users: 35_000,
                seats: 40,
                leaderboard_entries: 35_000,
                email_sends: 150_000
            }
        },
        {
            name: 'Enterprise',
            stripePriceId: STRIPE_PRICE.Enterprise || null,
            stripeProductId: STRIPE_PRODUCT.Enterprise || null,
            interval: 'year',
            isActive: true,
            manualInvoicing: false,
            limits: {
                campaigns: 500,
                referred_users: 100_000,
                seats: 100,
                leaderboard_entries: 100_000,
                email_sends: 500_000
            }
        }
    ];

    for (const plan of plans) {
        // Match on name + no tenantId (public plans only)
        const existing = await prisma.plan.findFirst({
            where: { name: plan.name, tenantId: null, deletedAt: null }
        });

        if (existing) {
            await prisma.plan.update({
                where: { id: existing.id },
                data: {
                    stripePriceId: plan.stripePriceId,
                    stripeProductId: plan.stripeProductId,
                    interval: plan.interval,
                    isActive: plan.isActive,
                    limits: plan.limits
                }
            });
            console.log(`✅ Plan updated:  ${plan.name} (id: ${existing.id})`);
        } else {
            const created = await prisma.plan.create({ data: plan });
            console.log(`✅ Plan created:  ${plan.name} (id: ${created.id})`);
        }
    }
}

async function seedTestTenant() {
    const tenant = await prisma.tenant.upsert({
        where: { id: TEST_TENANT_ID },
        update: {
            name: 'Test Tenant (dev)',
            status: 'active',
            paymentStatus: 'active'
        },
        create: {
            id: TEST_TENANT_ID,
            name: 'Test Tenant (dev)',
            slug: 'test-tenant-dev',
            status: 'active',
            paymentStatus: 'active'
        }
    });

    console.log(`✅ Tenant: ${tenant.name} (id: ${tenant.id})`);
    return tenant;
}

async function seedTestBilling() {
    const billing = await prisma.billing.upsert({
        where: { tenantId: TEST_TENANT_ID },
        update: {}, // Don't overwrite if already modified during testing
        create: {
            tenantId: TEST_TENANT_ID,
            plan: 'Free',
            status: 'none'
        }
    });

    console.log(`✅ Billing: plan=${billing.plan}, status=${billing.status} (tenantId: ${billing.tenantId})`);
}

async function seedDefaultTenant() {
    // This tenant ID is injected by Ory Hydra JWT tokens during local dev.
    // AlsAuthInterceptor resolves tenantId = user?.tenantId first, so any
    // request authenticated via Hydra will use this tenant.
    const tenant = await prisma.tenant.upsert({
        where: { id: DEFAULT_TENANT_ID },
        update: {
            name: 'Default Tenant (dev)',
            status: 'active',
            paymentStatus: 'active'
        },
        create: {
            id: DEFAULT_TENANT_ID,
            name: 'Default Tenant (dev)',
            slug: 'default-tenant',
            status: 'active',
            paymentStatus: 'active'
        }
    });

    const billing = await prisma.billing.upsert({
        where: { tenantId: DEFAULT_TENANT_ID },
        update: {},
        create: {
            tenantId: DEFAULT_TENANT_ID,
            plan: 'Free',
            status: 'none'
        }
    });

    console.log(`✅ Default tenant: ${tenant.name} (id: ${tenant.id})`);
    console.log(`✅ Default billing: plan=${billing.plan}, status=${billing.status}`);
}

/**
 * The role catalog (DB Model §3) — a projection for dashboard display and bulk assignment, not
 * the authoritative permission store, which is Ory Keto.
 *
 * `keto_relations` is derived from ROLE_GRANTS rather than written out here. That file is what the
 * tuple writer, the perms resolver and the guards all read, so deriving the projection from it is
 * the only way the two cannot disagree — and they did disagree: this seed used to write wildcards
 * ('tenant:*', 'users:*') that are not Keto relations and appear nowhere in the catalog.
 *
 * Descriptions carry the Product Spec §4 actor names (operator = Campaign Manager, viewer =
 * Analyst, support = Support Agent).
 */
async function seedRoles() {
    const descriptions: Record<RoleEnum, string> = {
        [RoleEnum.OWNER]: 'Owner — full access, including billing, API keys and DSR responses',
        [RoleEnum.OPERATOR]: 'Campaign Manager — campaigns, variants, segments, referrers; approve and reject rewards',
        [RoleEnum.SUPPORT]: 'Support Agent — read referrers, referrals and rewards; adjust a reward and resend its email',
        [RoleEnum.VIEWER]: 'Analyst — read-only'
    };

    const roles = Object.values(RoleEnum).map((name) => ({
        name,
        description: descriptions[name],
        ketoRelations: [...ROLE_GRANTS[name]]
    }));

    for (const role of roles) {
        await prisma.role.upsert({
            where: { name: role.name },
            update: { description: role.description, ketoRelations: role.ketoRelations },
            create: role
        });
    }

    console.log('✅ Roles:', roles.map((r) => `${r.name} (${r.ketoRelations.length} relations)`).join(', '));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('\n🌱 Starting seed...\n');

    await seedCurrencies();
    await seedRoles();
    await seedPlans();
    await seedTestTenant();
    await seedTestBilling();
    await seedDefaultTenant();

    console.log('\n✨ Seed complete.\n');
    console.log('─────────────────────────────────────────────────────');
    console.log('Swagger:    http://localhost:5001/docs');
    console.log(`Tenant ID:  ${TEST_TENANT_ID}  (manual header override)`);
    console.log(`Tenant ID:  ${DEFAULT_TENANT_ID}  (Ory Hydra JWT — auto-used)`);
    console.log('─────────────────────────────────────────────────────\n');
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
