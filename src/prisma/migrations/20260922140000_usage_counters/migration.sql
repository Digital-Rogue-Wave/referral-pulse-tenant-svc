-- Durable usage counters (they were only in Redis: losing Redis reset every limit).
CREATE TABLE "usage_counters" (
    "tenant_id" VARCHAR(26) NOT NULL,
    "metric" VARCHAR(100) NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("tenant_id", "metric", "period"),
    CONSTRAINT "usage_counters_value_check" CHECK ("value" >= 0)
);
