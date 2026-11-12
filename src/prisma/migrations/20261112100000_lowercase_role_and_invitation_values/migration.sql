-- E1 decision D3: enum values are lower-case on the wire, in the DB and in Keto (API Contract §1).
-- Keto role names were already lower-case; this aligns the stored values and the column defaults.
UPDATE "roles" SET "name" = lower("name") WHERE "name" <> lower("name");
UPDATE "users" SET "role" = lower("role") WHERE "role" <> lower("role");
UPDATE "invitations" SET "role" = lower("role"), "status" = lower("status") WHERE "role" <> lower("role") OR "status" <> lower("status");

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'operator';
ALTER TABLE "invitations" ALTER COLUMN "role" SET DEFAULT 'operator';
ALTER TABLE "invitations" ALTER COLUMN "status" SET DEFAULT 'pending';
