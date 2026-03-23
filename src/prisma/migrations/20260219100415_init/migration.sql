-- CreateEnum
CREATE TYPE "EffectType" AS ENUM ('sqs', 'sns', 'email', 'audit');

-- CreateTable
CREATE TABLE "currencies" (
    "code" VARCHAR(3) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "symbol" VARCHAR(10) NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "side_effect_outbox" (
    "id" TEXT NOT NULL,
    "tenant_id" VARCHAR(26) NOT NULL,
    "effect_type" "EffectType" NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" VARCHAR(26) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "metadata" JSONB,
    "scheduled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "last_error" TEXT,
    "processed_at" TIMESTAMPTZ,
    "idempotency_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "side_effect_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "totos" (
    "id" TEXT NOT NULL,
    "tenant_id" VARCHAR(26) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "process_count" INTEGER NOT NULL DEFAULT 0,
    "file_url" VARCHAR(500),
    "external_data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "totos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "side_effect_outbox_status_scheduled_at_idx" ON "side_effect_outbox"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "side_effect_outbox_tenant_id_status_idx" ON "side_effect_outbox"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "side_effect_outbox_aggregate_type_aggregate_id_idx" ON "side_effect_outbox"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "totos_tenant_id_status_idx" ON "totos"("tenant_id", "status");
