-- Durable Stripe webhook log and dedup (replaces the 24 h Redis marker), plus the per-subscription
-- watermark that stops an older Stripe event from overwriting newer state.
CREATE TABLE "stripe_events" (
    "id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "object_id" VARCHAR(255),
    "stripe_created_at" TIMESTAMPTZ NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stripe_events_status_check" CHECK ("status" IN ('received', 'processed', 'ignored', 'failed'))
);
CREATE INDEX "idx_stripe_events_status" ON "stripe_events"("status", "received_at");

ALTER TABLE "billings" ADD COLUMN "last_stripe_event_at" TIMESTAMPTZ;
