-- v5.2 DB Model §3: verification_status is unverified · pending_review · verified · rejected, and a tenant_verifications
-- row takes the tenant's values once started (pending_review · verified · rejected). E1 D15's `pending` (session opened)
-- and `in_review` (waiting for a Super Admin) become `pending_review`: in v5.2 a case exists only once the KYB provider
-- has called back, and every case is decided by a Super Admin.

ALTER TABLE "tenants" DROP CONSTRAINT "tenants_verification_status_check";
UPDATE "tenants" SET "verification_status" = 'pending_review' WHERE "verification_status" = 'pending';
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_verification_status_check"
    CHECK ("verification_status" IN ('unverified', 'pending_review', 'verified', 'rejected'));

ALTER TABLE "tenant_verifications" DROP CONSTRAINT "tenant_verifications_status_check";
UPDATE "tenant_verifications" SET "status" = 'pending_review' WHERE "status" IN ('pending', 'in_review');
ALTER TABLE "tenant_verifications" ALTER COLUMN "status" SET DEFAULT 'pending_review';
ALTER TABLE "tenant_verifications" ADD CONSTRAINT "tenant_verifications_status_check"
    CHECK ("status" IN ('pending_review', 'verified', 'rejected'));
