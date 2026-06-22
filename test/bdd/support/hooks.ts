/**
 * Cucumber Lifecycle Hooks
 *
 * BeforeAll  — boots NestJS test app once, registers nock interceptors
 * AfterAll   — closes the app, cleans up nock and Prisma connections
 *
 * Tagged Before/After — create / destroy fixture tenants per scenario
 */

import { BeforeAll, AfterAll, Before, After, setDefaultTimeout } from '@cucumber/cucumber';
import { bootstrapTestApp, teardownTestApp } from './app.bootstrap';
import { setupNock, teardownNock } from './nock.setup';
import {
    createSuspendedTenant,
    createLockedTenant,
    createActiveTenant,
    cleanupTenant,
    setActiveSubscription,
    clearSubscription,
    clearInvitations,
    seedPendingInvitation,
    cleanupInvitationFlow,
    disconnectFixturesPrisma,
    FIXTURE_IDS
} from './db.fixtures';
import type { BddWorldInterface } from './world';

// Give each scenario up to 30 s (NestJS boot + DB round-trips)
setDefaultTimeout(30_000);

// The default tenant the billing.feature Background authenticates as.
const DEFAULT_TENANT_ID = 'default-tenant';

// ─── Suite lifecycle ──────────────────────────────────────────────────────────

BeforeAll(async function () {
    // nock MUST be set up before the app boots so the JWKS intercept is in place
    setupNock();
    await bootstrapTestApp();
});

AfterAll(async function () {
    await teardownTestApp();
    teardownNock();
    await disconnectFixturesPrisma();
});

// ─── Fixture: clean invitations for the default tenant (idempotent re-runs) ──────

Before({ tags: '@needs-clean-invitations' }, async function () {
    await clearInvitations(DEFAULT_TENANT_ID);
});

// ─── Fixture: a pending invitation for the accept flow ───────────────────────────
// Token/email/kratos-id are shared with invitation.feature + the invitee-token step.
const INVITE_TOKEN = 'bdd-invite-token';
const INVITEE_EMAIL = 'invitee-bdd@acme.com';
const INVITEE_KRATOS_ID = 'kratos-invitee-bdd';

Before({ tags: '@needs-pending-invitation' }, async function () {
    await cleanupInvitationFlow({ tenantId: DEFAULT_TENANT_ID, token: INVITE_TOKEN, kratosIdentityId: INVITEE_KRATOS_ID });
    await seedPendingInvitation({ tenantId: DEFAULT_TENANT_ID, email: INVITEE_EMAIL, token: INVITE_TOKEN, role: 'OPERATOR' });
});

After({ tags: '@needs-pending-invitation' }, async function () {
    await cleanupInvitationFlow({ tenantId: DEFAULT_TENANT_ID, token: INVITE_TOKEN, kratosIdentityId: INVITEE_KRATOS_ID });
});

// ─── Fixture: suspended tenant ────────────────────────────────────────────────

Before({ tags: '@needs-suspended-tenant' }, async function (this: BddWorldInterface) {
    await createSuspendedTenant(FIXTURE_IDS.suspended);
    this.currentTenantId = FIXTURE_IDS.suspended;
});

After({ tags: '@needs-suspended-tenant' }, async function (this: BddWorldInterface) {
    if (this.currentTenantId) {
        await cleanupTenant(this.currentTenantId);
        this.currentTenantId = null;
    }
});

// ─── Fixture: locked tenant ───────────────────────────────────────────────────

Before({ tags: '@needs-locked-tenant' }, async function (this: BddWorldInterface) {
    await createLockedTenant(FIXTURE_IDS.locked);
    this.currentTenantId = FIXTURE_IDS.locked;
});

After({ tags: '@needs-locked-tenant' }, async function (this: BddWorldInterface) {
    if (this.currentTenantId) {
        await cleanupTenant(this.currentTenantId);
        this.currentTenantId = null;
    }
});

// ─── Fixture: active subscription (default tenant) ────────────────────────────

Before({ tags: '@needs-active-subscription' }, async function () {
    await setActiveSubscription(DEFAULT_TENANT_ID);
});

After({ tags: '@needs-active-subscription' }, async function () {
    await clearSubscription(DEFAULT_TENANT_ID);
});

// ─── Fixture: active tenant ───────────────────────────────────────────────────

Before({ tags: '@needs-active-tenant' }, async function (this: BddWorldInterface) {
    await createActiveTenant(FIXTURE_IDS.active);
    this.currentTenantId = FIXTURE_IDS.active;
});

After({ tags: '@needs-active-tenant' }, async function (this: BddWorldInterface) {
    if (this.currentTenantId) {
        await cleanupTenant(this.currentTenantId);
        this.currentTenantId = null;
    }
});
