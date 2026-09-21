-- Request idempotency (API Contract v1.3 §1, DB Model v2 §0.7).
-- CreateTable
CREATE TABLE "idempotency_keys" (
    "tenant_id" VARCHAR(80) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "response_status" SMALLINT,
    "response_body" JSONB,
    "target_resource_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("tenant_id","idempotency_key")
);

-- CreateIndex
CREATE INDEX "idx_idem_expiry" ON "idempotency_keys"("expires_at");

