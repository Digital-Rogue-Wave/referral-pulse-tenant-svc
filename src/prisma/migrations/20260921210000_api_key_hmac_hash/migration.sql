-- API keys: deterministic HMAC key hash, 4-char display prefix, no scopes (DB Model v2 §3 `api_keys`).
--
-- Keys issued before this migration were bcrypt-hashed. Their raw values are unknown, so they cannot be
-- re-hashed; they are revoked here and must be re-issued (no production keys exist at this point).

UPDATE "api_keys" SET "revoked_at" = now(), "deleted_at" = coalesce("deleted_at", now()) WHERE "revoked_at" IS NULL;

ALTER TABLE "api_keys" DROP COLUMN "scopes";
ALTER TABLE "api_keys" ALTER COLUMN "key_hash" TYPE VARCHAR(64);
ALTER TABLE "api_keys" ALTER COLUMN "key_prefix" TYPE CHAR(4);
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_type_check" CHECK ("key_type" IN ('secret', 'publishable'));

DROP INDEX IF EXISTS "api_keys_key_prefix_idx";
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE UNIQUE INDEX "api_keys_tenant_id_key_prefix_key" ON "api_keys"("tenant_id", "key_prefix");
