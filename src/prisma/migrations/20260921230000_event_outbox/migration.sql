-- Transactional outbox for domain events (DB Model v2 §0.6).
-- CreateTable
CREATE TABLE "event_outbox" (
    "id" CHAR(26) NOT NULL,
    "tenant_id" VARCHAR(26) NOT NULL,
    "event_type" VARCHAR(128) NOT NULL,
    "external_id" VARCHAR(256) NOT NULL,
    "schema_version" SMALLINT NOT NULL DEFAULT 1,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "attempt_count" SMALLINT NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "published_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_outbox_status_created" ON "event_outbox"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_outbox_tenant_id_event_type_external_id_key" ON "event_outbox"("tenant_id", "event_type", "external_id");


ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_status_check" CHECK ("status" IN ('pending', 'published', 'failed'));
-- The relay's hot path (DB Model v2 §0.6 `idx_outbox_pending`): only pending rows, oldest first.
CREATE INDEX "idx_outbox_pending" ON "event_outbox" ("created_at") WHERE "status" = 'pending';
