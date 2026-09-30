-- DB Model v2 §3 `tenant_verifications`: the KYB workflow record behind tenants.verification_status.
CREATE TABLE "tenant_verifications" (
    "id" VARCHAR(26) NOT NULL,
    "tenant_id" VARCHAR(26) NOT NULL,
    "verification_type" VARCHAR(20) NOT NULL DEFAULT 'company',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "evidence" JSONB,
    "temporal_workflow_id" VARCHAR(255),
    "temporal_run_id" VARCHAR(255),
    "reviewed_by" VARCHAR(80),
    "reviewed_at" TIMESTAMPTZ,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "tenant_verifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_verifications_type_check" CHECK ("verification_type" IN ('company', 'tax', 'payout_provider')),
    CONSTRAINT "tenant_verifications_status_check" CHECK ("status" IN ('pending', 'in_review', 'verified', 'rejected'))
);
CREATE INDEX "idx_verif_tenant" ON "tenant_verifications"("tenant_id", "status");
ALTER TABLE "tenant_verifications" ADD CONSTRAINT "tenant_verifications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A tenant already waiting for review gets its open company verification.
INSERT INTO "tenant_verifications" ("id", "tenant_id", "verification_type", "status", "updated_at")
SELECT '01K5' || upper(substr(md5("id"), 1, 22)), "id", 'company', 'pending', CURRENT_TIMESTAMP
FROM "tenants" WHERE "verification_status" = 'pending';
