-- DB Model v2 §3: one tenant status vocabulary, spec verification states, residency and retention columns,
-- and an operator status. Enum columns stay text + CHECK (§0.3).

UPDATE "tenants" SET "status" = 'closed' WHERE "status" = 'deleted';
UPDATE "tenants" SET "status" = 'active' WHERE "status" NOT IN ('active', 'suspended', 'locked', 'closed');
UPDATE "tenants" SET "verification_status" = 'pending' WHERE "verification_status" = 'pending_review';

ALTER TABLE "tenants"
    ADD COLUMN "data_region" VARCHAR(32) NOT NULL DEFAULT 'eu-central-1',
    ADD COLUMN "retention_months" SMALLINT NOT NULL DEFAULT 24,
    ADD COLUMN "metadata" JSONB,
    ADD CONSTRAINT "tenants_status_check" CHECK ("status" IN ('active', 'suspended', 'locked', 'closed')),
    ADD CONSTRAINT "tenants_verification_status_check" CHECK ("verification_status" IN ('unverified', 'pending', 'verified', 'rejected')),
    ADD CONSTRAINT "tenants_retention_months_check" CHECK ("retention_months" BETWEEN 6 AND 36);

ALTER TABLE "users" ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'active';
UPDATE "users" SET "status" = 'disabled' WHERE "deleted_at" IS NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('invited', 'active', 'disabled'));
