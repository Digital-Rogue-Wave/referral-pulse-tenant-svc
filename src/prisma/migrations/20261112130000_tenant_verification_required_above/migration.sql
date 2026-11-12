-- E1 decision D11 (US1.7.2 F3): the Owner's payout verification threshold, held by the tenant (v5.1).
ALTER TABLE "tenants" ADD COLUMN "verification_required_above" INTEGER,
ADD COLUMN "verification_required_above_currency" CHAR(3);

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_verification_required_above_check"
    CHECK ("verification_required_above" IS NULL OR ("verification_required_above" >= 0 AND "verification_required_above_currency" IS NOT NULL));
