import pg from 'pg';

import { alsStorage } from '@common/tenant-aware/tenant-context.service';

type PoolClient = pg.PoolClient;
type QueryConfig = Parameters<PoolClient['query']>[0];

const SET_TENANT = "SELECT set_config('app.tenant_id', $1, true)";
const tenantOf = (): string => alsStorage.getStore()?.tenantId ?? '';
const isBegin = (statement: unknown): boolean => {
    const text = typeof statement === 'string' ? statement : (statement as { text?: unknown } | null)?.text;
    return typeof text === 'string' && text.trim().toUpperCase() === 'BEGIN';
};

/** Marks a pooled client as already wrapped, so a reused connection is patched once. */
const WRAPPED = Symbol('tenantScoped');

/**
 * The pool the Prisma adapter runs on (v5.2 DB Model §0.8, US1.3.9). Every transaction this pool opens starts with
 * `set_config('app.tenant_id', <tenant of the request>, true)` — `SET LOCAL` semantics, so the value cannot leak to the
 * next user of the connection — and the row-level security policies read it. A statement Prisma sends outside a
 * transaction is run inside one for the same reason. Without a tenant in the request context the setting is empty and
 * the policies return no tenant row at all.
 *
 * `@prisma/adapter-pg` (7.x) sends plain statements through `pool.query()` and opens transactions with `pool.connect()`
 * then `BEGIN`; both are covered here, so no service code changes to get the setting.
 *
 * PrismaPromises are lazy: a query starts when it is awaited. Work run in another tenant's context
 * (`TenantContextService.runWithContext`) must await its queries inside that callback — returning an unstarted
 * PrismaPromise from it runs the query after the context has ended, with no tenant.
 */
export class TenantScopedPool extends pg.Pool {
    constructor(config: pg.PoolConfig) {
        super(config);
        // Assigned rather than overridden: pg types `query` with callback overloads the adapter never uses.
        this.query = this.queryInTransaction.bind(this) as pg.Pool['query'];
    }

    override async connect(): Promise<PoolClient> {
        return wrap(await super.connect());
    }

    private async queryInTransaction(config: QueryConfig, values?: unknown[]): Promise<unknown> {
        const client = await this.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(config as never, values as never);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
    }
}

function wrap(client: PoolClient): PoolClient {
    const marked = client as PoolClient & { [WRAPPED]?: true };
    if (marked[WRAPPED]) {
        return client;
    }
    const query = client.query.bind(client) as (statement: unknown, values?: unknown) => Promise<unknown>;
    (client as unknown as { query: unknown }).query = async (statement: unknown, values?: unknown) => {
        const result = await query(statement, values);
        if (isBegin(statement)) {
            await query(SET_TENANT, [tenantOf()]);
        }
        return result;
    };
    marked[WRAPPED] = true;
    return client;
}
