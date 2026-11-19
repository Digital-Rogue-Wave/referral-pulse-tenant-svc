-- v5.2 API §3.16 / DB Model §3 `connections`: the table takes its spec name and the Connection lifecycle.
--   direction  inbound | outbound | both (fixed by the provider matrix, backfilled from the provider)
--   status     pending_verification → active → revoked (live rows start pending: none was verified under v5.2)
--   credentials_encrypted                outbound api_key / oauth_code, sealed JSON
--   signing_secret_encrypted             renamed from signing_secret
--   previous_signing_secret_encrypted    + previous_secret_valid_until: the rotated-out secret, honoured 24 h
--   last_verified_at, last_sync_at
-- `connection_type` (derived from the provider) and `enabled` (= status <> revoked) are replaced.

ALTER TABLE "provider_connections" RENAME TO "connections";
ALTER TABLE "connections" RENAME CONSTRAINT "provider_connections_pkey" TO "connections_pkey";
ALTER TABLE "connections" RENAME CONSTRAINT "provider_connections_tenant_id_fkey" TO "connections_tenant_id_fkey";
ALTER TABLE "connections" DROP CONSTRAINT "provider_connections_provider_check";
ALTER TABLE "connections" DROP CONSTRAINT "provider_connections_type_check";

ALTER TABLE "connections" RENAME COLUMN "signing_secret" TO "signing_secret_encrypted";
ALTER TABLE "connections"
    ADD COLUMN "direction" VARCHAR(10),
    ADD COLUMN "status" VARCHAR(24) NOT NULL DEFAULT 'pending_verification',
    ADD COLUMN "credentials_encrypted" TEXT,
    ADD COLUMN "previous_signing_secret_encrypted" TEXT,
    ADD COLUMN "previous_secret_valid_until" TIMESTAMPTZ,
    ADD COLUMN "last_verified_at" TIMESTAMPTZ,
    ADD COLUMN "last_sync_at" TIMESTAMPTZ;

UPDATE "connections" SET "direction" = CASE
    WHEN "provider" IN ('stripe', 'paddle', 'chargebee') THEN 'inbound'
    WHEN "provider" = 'zapier' THEN 'outbound'
    ELSE 'both'
END;
UPDATE "connections" SET "status" = 'revoked', "revoked_at" = COALESCE("revoked_at", "updated_at")
WHERE "revoked_at" IS NOT NULL OR "enabled" = false;

ALTER TABLE "connections" ALTER COLUMN "direction" SET NOT NULL;
ALTER TABLE "connections" DROP COLUMN "connection_type", DROP COLUMN "enabled";

ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_check" CHECK (
    "provider" IN ('stripe', 'paddle', 'chargebee', 'paypal', 'wise', 'tremendous', 'hubspot', 'salesforce', 'zapier')
    OR ("provider" = 'crm' AND "status" = 'revoked')
);
ALTER TABLE "connections" ADD CONSTRAINT "connections_direction_check" CHECK ("direction" IN ('inbound', 'outbound', 'both'));
ALTER TABLE "connections" ADD CONSTRAINT "connections_status_check" CHECK ("status" IN ('pending_verification', 'active', 'revoked'));

DROP INDEX "idx_provider_conn_tenant";
DROP INDEX "idx_provider_conn_provider";
ALTER INDEX "idx_provider_conn_live" RENAME TO "idx_connections_live";
CREATE INDEX "idx_connections_tenant_provider" ON "connections"("tenant_id", "provider", "status");
