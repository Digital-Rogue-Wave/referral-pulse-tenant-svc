-- The deletion saga is driven from the database: a tenant is due once deletion_due_at has passed.
ALTER TABLE "tenants" ADD COLUMN "deletion_due_at" TIMESTAMPTZ;
UPDATE "tenants" SET "deletion_due_at" = "deletion_scheduled_at" + INTERVAL '30 days'
    WHERE "deletion_scheduled_at" IS NOT NULL AND "status" <> 'closed';
CREATE INDEX "idx_tenants_deletion_due" ON "tenants" ("deletion_due_at") WHERE "deletion_due_at" IS NOT NULL AND "status" <> 'closed';
