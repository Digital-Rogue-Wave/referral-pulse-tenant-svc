-- Harmonize every application-generated primary key to ULID.
--
-- Per the platform ruling, all microservices use ULID and no longer cuid, so the
-- 13 `@default(cuid())` primary keys become `@default(ulid())` and their columns
-- are pinned to VARCHAR(26) — ULID's exact width, and already the declared width
-- of every foreign-key column that points at them (`tenant_id`, `created_by`,
-- `assigned_by`, …). Before this, PKs were unbounded `text` while their FKs were
-- `varchar(26)`; the mismatch only worked because cuid v1 is 25 characters.
--
-- `ulid()` is a Prisma *client-side* default, so it produces no DDL here: existing
-- rows keep their cuid values (25 chars, still valid under varchar(26)) and only
-- new rows get ULIDs. No backfill is required or performed.
--
-- Written by hand rather than taken from `prisma migrate diff`: the generated
-- version dropped only the foreign keys whose own columns change type, and missed
-- the nine that merely *reference* a changing primary key. Postgres refuses to
-- drop a PK constraint while another table's FK depends on its index
-- (SQLSTATE 2BP01), so every dependent constraint is dropped up front and
-- restored at the end.

-- ── Drop foreign keys that depend on a primary key being altered ─────────────
-- References files.id
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_image_id_fkey";
-- Reference tenants.id
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_tenant_id_fkey";
ALTER TABLE "billing_events" DROP CONSTRAINT IF EXISTS "billing_events_tenant_id_fkey";
ALTER TABLE "billings" DROP CONSTRAINT IF EXISTS "billings_tenant_id_fkey";
ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_tenant_id_fkey";
ALTER TABLE "tenant_settings" DROP CONSTRAINT IF EXISTS "tenant_settings_tenant_id_fkey";
ALTER TABLE "tenant_usages" DROP CONSTRAINT IF EXISTS "tenant_usages_tenant_id_fkey";
ALTER TABLE "user_notification_preferences" DROP CONSTRAINT IF EXISTS "user_notification_preferences_tenant_id_fkey";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_tenant_id_fkey";
-- Reference users.id / roles.id
ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_user_id_fkey";
ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_role_id_fkey";

-- ── Widen the primary keys ──────────────────────────────────────────────────
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");

ALTER TABLE "billing_events" DROP CONSTRAINT "billing_events_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id");

ALTER TABLE "billings" DROP CONSTRAINT "billings_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "billings_pkey" PRIMARY KEY ("id");

ALTER TABLE "files" DROP CONSTRAINT "files_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "files_pkey" PRIMARY KEY ("id");

ALTER TABLE "invitations" DROP CONSTRAINT "invitations_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");

ALTER TABLE "plans" DROP CONSTRAINT "plans_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "plans_pkey" PRIMARY KEY ("id");

ALTER TABLE "roles" DROP CONSTRAINT "roles_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");

ALTER TABLE "side_effect_outbox" DROP CONSTRAINT "side_effect_outbox_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "side_effect_outbox_pkey" PRIMARY KEY ("id");

ALTER TABLE "tenant_settings" DROP CONSTRAINT "tenant_settings_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id");

ALTER TABLE "tenant_usages" DROP CONSTRAINT "tenant_usages_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "tenant_usages_pkey" PRIMARY KEY ("id");

ALTER TABLE "tenants" DROP CONSTRAINT "tenants_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");

ALTER TABLE "user_notification_preferences" DROP CONSTRAINT "user_notification_preferences_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("id");

ALTER TABLE "users" DROP CONSTRAINT "users_pkey",
    ALTER COLUMN "id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- user_roles' own key columns were the only id-bearing columns with no declared
-- width, so they are aligned here too.
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_pkey",
    ALTER COLUMN "user_id" SET DATA TYPE VARCHAR(26),
    ALTER COLUMN "role_id" SET DATA TYPE VARCHAR(26),
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id");

-- ── Restore the foreign keys ────────────────────────────────────────────────
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_image_id_fkey"
    FOREIGN KEY ("image_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billings" ADD CONSTRAINT "billings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_usages" ADD CONSTRAINT "tenant_usages_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
