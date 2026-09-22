-- DB Model v2 §3 `audit_log` (append-only operator-action trail). No FK to `tenants`: the trail must outlive
-- the tenant row's purge for the API §8.3 "tenant lifetime + 12 months" window.
CREATE TABLE "audit_log" (
    "id" VARCHAR(26) NOT NULL,
    "tenant_id" VARCHAR(26) NOT NULL,
    "actor_user_id" VARCHAR(80) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "target_type" VARCHAR(50),
    "target_id" VARCHAR(64),
    "reason" TEXT,
    "request_id" VARCHAR(64),
    "ip_hash" CHAR(64),
    "before" JSONB,
    "after" JSONB,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_audit_tenant_time" ON "audit_log"("tenant_id", "occurred_at" DESC);
CREATE INDEX "idx_audit_target" ON "audit_log"("tenant_id", "target_type", "target_id");

-- The `email` and `audit` side-effect types were placeholders that only logged; nothing produces them now.
DELETE FROM "side_effect_outbox" WHERE "effect_type" IN ('email', 'audit');
ALTER TABLE "side_effect_outbox" DROP CONSTRAINT "side_effect_outbox_effect_type_check";
ALTER TABLE "side_effect_outbox" ADD CONSTRAINT "side_effect_outbox_effect_type_check" CHECK ("effect_type" IN ('sqs', 'sns', 'keto'));
