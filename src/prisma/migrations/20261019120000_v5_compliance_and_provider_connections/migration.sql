-- Product Spec R-CPL-01/R-CPL-02 and Architecture v5 §2.1 assign this service the consent registry,
-- the DSR endpoint with its per-service receipts, and provider connection config + secrets. DB Model
-- v5 §3 lists no tables for any of them, so these four are derived from the prose that assigns the
-- responsibility. The decisions (single-key ULID vs §0.1's dual key, the invented DSR status values,
-- the encrypted-column secret) are recorded in NOTE.md §V5.12.

-- R-CPL-01 consent registry. Append-only: a withdrawal is a new row, so the proof of what was
-- consented to, and when, stays intact (DB Model §0.4 "correction = a new compensating row").
CREATE TABLE "consents" (
    "id" VARCHAR(26) NOT NULL,
    "tenant_id" VARCHAR(26) NOT NULL,
    "subject_id" VARCHAR(26),
    "subject_email_hash" CHAR(64),
    "subject_external_id" VARCHAR(255),
    "tracking_consent" VARCHAR(20) NOT NULL,
    "marketing_consent" VARCHAR(20),
    "consent_source" VARCHAR(20),
    "recorded_at" TIMESTAMPTZ NOT NULL,
    "withdrawn_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consents_pkey" PRIMARY KEY ("id"),
    -- Event Model §2.4's three-value consent enum, the same one ingestion validates against.
    CONSTRAINT "consents_tracking_check" CHECK ("tracking_consent" IN ('granted', 'denied', 'pending')),
    CONSTRAINT "consents_marketing_check" CHECK ("marketing_consent" IN ('granted', 'denied', 'pending')),
    CONSTRAINT "consents_source_check" CHECK ("consent_source" IN ('cmp_banner', 'signup_form', 'api', 'widget', 'inherited')),
    -- A consent record with no subject is unattributable, which makes it useless as evidence.
    CONSTRAINT "consents_subject_present_check" CHECK (
        "subject_id" IS NOT NULL OR "subject_email_hash" IS NOT NULL OR "subject_external_id" IS NOT NULL
    )
);
CREATE INDEX "idx_consent_subject" ON "consents"("tenant_id", "subject_id", "recorded_at" DESC);
CREATE INDEX "idx_consent_email" ON "consents"("tenant_id", "subject_email_hash", "recorded_at" DESC);
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- R-CPL-02 data-subject requests: access, erasure or portability, due within one month.
CREATE TABLE "dsr_requests" (
    "id" VARCHAR(26) NOT NULL,
    "tenant_id" VARCHAR(26) NOT NULL,
    "subject_id" VARCHAR(26),
    "subject_email_hash" CHAR(64),
    "subject_external_id" VARCHAR(255),
    "request_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "requested_by" VARCHAR(26),
    "due_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "temporal_workflow_id" VARCHAR(255),
    "temporal_run_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "dsr_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dsr_requests_type_check" CHECK ("request_type" IN ('access', 'erasure', 'portability')),
    -- R-CPL-02 names the three request types but not the lifecycle; these four are this service's,
    -- shaped after `tenant_verifications.status` so both workflows read the same way.
    CONSTRAINT "dsr_requests_status_check" CHECK ("status" IN ('pending', 'in_progress', 'completed', 'failed')),
    CONSTRAINT "dsr_requests_subject_present_check" CHECK (
        "subject_id" IS NOT NULL OR "subject_email_hash" IS NOT NULL OR "subject_external_id" IS NOT NULL
    )
);
CREATE INDEX "idx_dsr_tenant_status" ON "dsr_requests"("tenant_id", "status", "due_at");
CREATE INDEX "idx_dsr_subject_email" ON "dsr_requests"("tenant_id", "subject_email_hash");
ALTER TABLE "dsr_requests" ADD CONSTRAINT "dsr_requests_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One receipt per service per request: R-CPL-02 has `erasure.completed` carry all of them, so they
-- are stored as evidence rather than counted. The unique key makes a re-delivered receipt idempotent.
CREATE TABLE "dsr_receipts" (
    "id" VARCHAR(26) NOT NULL,
    "dsr_request_id" VARCHAR(26) NOT NULL,
    "tenant_id" VARCHAR(26) NOT NULL,
    "service_name" VARCHAR(60) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "receipt" JSONB,
    "retained_under_obligation" BOOLEAN NOT NULL DEFAULT false,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dsr_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dsr_receipts_status_check" CHECK ("status" IN ('completed', 'partial', 'failed'))
);
CREATE UNIQUE INDEX "dsr_receipts_dsr_request_id_service_name_key" ON "dsr_receipts"("dsr_request_id", "service_name");
CREATE INDEX "idx_dsr_receipt_tenant" ON "dsr_receipts"("tenant_id");
ALTER TABLE "dsr_receipts" ADD CONSTRAINT "dsr_receipts_dsr_request_id_fkey"
    FOREIGN KEY ("dsr_request_id") REFERENCES "dsr_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Architecture §2.1: provider connection config and secrets, cached by Event Ingestion to verify
-- inbound provider callbacks. The row id is the `{connection_id}` in ingestion's callback path.
CREATE TABLE "provider_connections" (
    "id" VARCHAR(26) NOT NULL,
    "tenant_id" VARCHAR(26) NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "connection_type" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100),
    "signing_secret" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_received_at" TIMESTAMPTZ,
    "created_by" VARCHAR(26),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id"),
    -- The same list DB Model §10 constrains `inbound_webhook_receipts.provider` to, so a connection
    -- and the receipt it produces cannot disagree about who sent the callback.
    CONSTRAINT "provider_connections_provider_check" CHECK (
        "provider" IN ('stripe', 'paddle', 'chargebee', 'paypal', 'wise', 'gift_card', 'crm')
    ),
    CONSTRAINT "provider_connections_type_check" CHECK ("connection_type" IN ('billing', 'payout', 'crm'))
);
CREATE INDEX "idx_provider_conn_tenant" ON "provider_connections"("tenant_id");
CREATE INDEX "idx_provider_conn_provider" ON "provider_connections"("tenant_id", "provider");
-- Partial, so revoking a connection frees the slot for its replacement instead of blocking it.
CREATE UNIQUE INDEX "idx_provider_conn_live" ON "provider_connections"("tenant_id", "provider")
    WHERE "revoked_at" IS NULL;
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
