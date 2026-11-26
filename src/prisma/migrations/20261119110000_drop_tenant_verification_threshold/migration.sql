-- v5.2 API §3.1 / DB Model §4: verification_required_above is a Program setting (campaign_db.programs), in minor units
-- with no currency column. The tenant-level copy of E1 decision D11 goes.
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "verification_required_above_currency";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "verification_required_above";
