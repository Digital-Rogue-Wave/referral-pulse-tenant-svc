-- Identity lifecycle (batch 2, T2) + outbox effect type as text.
-- Data-preserving: every change backfills from existing values instead of dropping them.

-- ── side_effect_outbox.effect_type: native enum → text + CHECK (DB Model v2 §0.3), adding `keto` ──
ALTER TABLE "side_effect_outbox" ALTER COLUMN "effect_type" TYPE VARCHAR(20) USING "effect_type"::text;
DROP TYPE "EffectType";
ALTER TABLE "side_effect_outbox"
    ADD CONSTRAINT "side_effect_outbox_effect_type_check" CHECK ("effect_type" IN ('sqs', 'sns', 'email', 'audit', 'keto'));

-- ── invitations: store only a SHA-256 of the token (the token lives only in the invitee's link) ──
ALTER TABLE "invitations" ADD COLUMN "token_hash" CHAR(64);
UPDATE "invitations" SET "token_hash" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
ALTER TABLE "invitations" ALTER COLUMN "token_hash" SET NOT NULL;
DROP INDEX "invitations_token_key";
ALTER TABLE "invitations" DROP COLUMN "token";
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- ── users: email required + email_hash; one Ory identity per tenant membership platform-wide ──
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "users" ADD COLUMN "email_hash" CHAR(64);
UPDATE "users" SET "email_hash" = encode(sha256(convert_to(lower("email"), 'UTF8')), 'hex');
ALTER TABLE "users" ALTER COLUMN "email_hash" SET NOT NULL;
DROP INDEX "users_tenant_id_kratos_identity_id_key";
CREATE UNIQUE INDEX "users_kratos_identity_id_key" ON "users"("kratos_identity_id");
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- ── roles: the legacy MEMBER role is not one of the four platform roles (API §2) ──
DELETE FROM "roles" WHERE "name" = 'MEMBER' AND NOT EXISTS (SELECT 1 FROM "user_roles" ur WHERE ur."role_id" = "roles"."id");
