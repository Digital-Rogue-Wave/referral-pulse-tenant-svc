-- E1 decision D6 (US1.4.2 F1): revoking a key is its soft delete; the row stays listable.
ALTER TABLE "api_keys" ADD COLUMN "revoked_by" VARCHAR(26),
ADD COLUMN "revocation_reason" VARCHAR(500);

-- Keys revoked before this change were also marked deleted at the same instant; they were revocations,
-- not deletions, so they become visible again as revoked keys.
UPDATE "api_keys" SET "deleted_at" = NULL WHERE "revoked_at" IS NOT NULL AND "deleted_at" = "revoked_at";
