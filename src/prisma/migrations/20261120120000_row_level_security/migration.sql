-- v5.2 DB Model §0.8 / US1.3.9: row-level security on every tenant-scoped table, as defence in depth behind the
-- application's own tenant scoping. Each table with a tenant_id column gets one policy, enabled and FORCED (so it binds
-- the table owner too), comparing the row's tenant with the `app.tenant_id` setting the application sets per
-- transaction (`TenantScopedPool`). No setting, or an empty one, matches no row: a missed tenant filter returns nothing.
-- Platform rows (tenant_id null: platform plans, platform files) are readable by every tenant.
-- Ids are ULIDs in VARCHAR, so the comparison is on text (the spec's `::uuid` cast assumes uuid columns).
-- Runtime connects as a role without BYPASSRLS; migrations and the audited cross-tenant paths use the privileged role.

DO $$
DECLARE
    t record;
BEGIN
    FOR t IN
        SELECT c.table_name, c.is_nullable
        FROM information_schema.columns c
        JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t.table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) '
            'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
            t.table_name
        );
        IF t.is_nullable = 'YES' THEN
            EXECUTE format('DROP POLICY IF EXISTS platform_rows_read ON %I', t.table_name);
            EXECUTE format('CREATE POLICY platform_rows_read ON %I FOR SELECT USING (tenant_id IS NULL)', t.table_name);
        END IF;
    END LOOP;
END $$;
