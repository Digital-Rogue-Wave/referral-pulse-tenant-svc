/**
 * Row-level security (tenant-service extension; the v5.2 story is centrally owned). The catalogue checks read pg_catalog through the privileged
 * fixtures connection; the isolation checks go through the application's own connection (`DatabaseService`, the
 * RLS-bound role), with and without a tenant in the request context. Companies are signed up with the `bdd-bp-` slug,
 * so `billing-plan.steps.ts` removes them.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { randomUUID } from 'crypto';
import pg from 'pg';

import { DatabaseService } from '../../../../src/database/database.service';
import { TenantContextService } from '../../../../src/common/tenant-aware/tenant-context.service';
import { getTestApp } from '../../support/app.bootstrap';
import { fixturesPrisma } from '../../support/db.fixtures';
import type { BddWorldInterface } from '../../support/world';

type Row = Record<string, unknown>;

let companies: string[] = [];
let listed: { tenantId: string }[] = [];

const catalog = <T extends Row>(sql: string): Promise<T[]> => fixturesPrisma.$queryRawUnsafe<T[]>(sql);

/** A plain connection as the application role, outside Prisma, so no tenant setting is made for it. */
async function asApplicationRole<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
        return await work(client);
    } finally {
        await client.end();
    }
}

async function signUp(world: BddWorldInterface): Promise<string> {
    const identityId = `kratos-bdd-rls-${randomUUID()}`;
    const response = await world
        .agent()
        .post('/api/v1/webhook/ory/signup')
        .set('x-ory-api-key', String(process.env['ORY_WEBHOOK_API_KEY']))
        .send({ identity: { id: identityId, traits: { email: `${identityId}@acme.com`, tenantName: `bdd-bp rls ${randomUUID().slice(0, 8)}` } } });
    assert.strictEqual(response.status, 201, `Sign-up failed: ${JSON.stringify(response.body)}`);
    return (response.body as { tenant_id: string }).tenant_id;
}

Then('every table with a tenant_id column has row-level security enabled and forced', async function () {
    const rows = await catalog<{ table_name: string; enabled: boolean; forced: boolean }>(`
        SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND EXISTS (SELECT 1 FROM information_schema.columns col
                      WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id')`);
    assert.ok(rows.length > 0, 'no tenant-scoped table found');
    const unprotected = rows.filter((r) => !r.enabled || !r.forced).map((r) => r.table_name);
    assert.deepStrictEqual(unprotected, [], `tables without forced row-level security: ${unprotected.join(', ')}`);
});

Then('each of them has the tenant_isolation policy', async function () {
    const missing = await catalog<{ table_name: string }>(`
        SELECT col.table_name FROM information_schema.columns col
        JOIN information_schema.tables t ON t.table_schema = col.table_schema AND t.table_name = col.table_name AND t.table_type = 'BASE TABLE'
        WHERE col.table_schema = 'public' AND col.column_name = 'tenant_id'
          AND NOT EXISTS (SELECT 1 FROM pg_policies p
                          WHERE p.schemaname = 'public' AND p.tablename = col.table_name AND p.policyname = 'tenant_isolation')`);
    assert.deepStrictEqual(
        missing.map((r) => r.table_name),
        []
    );
});

Then('the application connection is neither a superuser nor allowed to bypass row-level security', async function () {
    const [role] = await asApplicationRole(
        async (client) => (await client.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows
    );
    assert.deepStrictEqual(role, { rolsuper: false, rolbypassrls: false });
});

Then('a query on users without a tenant setting returns no rows', async function () {
    const [total] = await catalog<{ n: bigint }>('SELECT count(*) AS n FROM users');
    assert.ok(Number(total!.n) > 0, 'the check needs at least one user in the database');
    const visible = await asApplicationRole(async (client) => Number((await client.query('SELECT count(*) AS n FROM users')).rows[0].n));
    assert.strictEqual(visible, 0);
});

Given('two companies have signed up', async function (this: BddWorldInterface) {
    companies = [await signUp(this), await signUp(this)];
});

When("the first company's request lists users with no tenant filter", async function () {
    const prisma = getTestApp().get(DatabaseService);
    // The app's own context service: the same AsyncLocalStorage the connection pool reads.
    listed = await getTestApp()
        .get(TenantContextService)
        .runWithContext({ tenantId: companies[0] }, async () => await prisma.user.findMany({ select: { tenantId: true } }));
});

Then('every row returned belongs to the first company', function () {
    assert.ok(listed.length > 0, 'the first company has its Owner');
    assert.deepStrictEqual([...new Set(listed.map((r) => r.tenantId))], [companies[0]]);
});

Then("the second company's users are not among them", async function () {
    const second = await fixturesPrisma.user.count({ where: { tenantId: companies[1] } });
    assert.ok(second > 0, 'the second company has its Owner');
    assert.ok(!listed.some((r) => r.tenantId === companies[1]));
});
