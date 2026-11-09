-- US1.9.1 F3: `audit_log` is append-only in the database, not only by convention (DB Model §3).
--
-- UPDATE and TRUNCATE are always refused. DELETE is refused unless the transaction opted in with
-- `SELECT set_config('app.audit_purge', 'on', true)` — the setting is transaction-local, so it ends with
-- that transaction. Only the retention sweeper does this, for tenants closed for more than 12 months
-- (API Contract §8.3: tenant lifetime + 12 months).
--
-- This stops mistakes and code paths, not the database owner: a superuser can still disable the trigger.

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.audit_purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_log is append-only: % refused', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_append_only_rows
    BEFORE UPDATE OR DELETE ON "audit_log"
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_append_only_truncate
    BEFORE TRUNCATE ON "audit_log"
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
