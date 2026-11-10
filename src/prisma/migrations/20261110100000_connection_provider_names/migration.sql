-- US1.5.1 F7 (v5.1): a connection names its real provider, not a category, and gift cards are their own type.
-- The platform calls each provider's own API for payouts and gift cards (Payout Model R-PAY-01/03, R-RWD-07).
--
--   provider:         stripe | paddle | chargebee | paypal | wise | tremendous | hubspot | salesforce
--   connection_type:  billing | payout | gift_card | crm   (derived from the provider by the service)
--
-- Mirrored by event-svc's `inbound_webhook_receipts.provider` (its migration of the same day).

ALTER TABLE "provider_connections" DROP CONSTRAINT "provider_connections_provider_check";
ALTER TABLE "provider_connections" DROP CONSTRAINT "provider_connections_type_check";

-- `gift_card` connections were Tremendous connections: Event Ingestion verified their callbacks with Tremendous's
-- own `Tremendous-Webhook-Signature` header. Same row, same URL owner; only the name and the type change.
UPDATE "provider_connections" SET "provider" = 'tremendous', "connection_type" = 'gift_card', "updated_at" = now()
WHERE "provider" = 'gift_card';

-- `crm` doesn't say which vendor it is, so a live one can't be renamed: it is revoked, and its Owner creates it
-- again as `hubspot` or `salesforce`. The row stays, so its past receipts remain attributable.
UPDATE "provider_connections" SET "enabled" = false, "revoked_at" = now(), "updated_at" = now()
WHERE "provider" = 'crm' AND "revoked_at" IS NULL;

ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_provider_check" CHECK (
    "provider" IN ('stripe', 'paddle', 'chargebee', 'paypal', 'wise', 'tremendous', 'hubspot', 'salesforce')
    OR ("provider" = 'crm' AND "revoked_at" IS NOT NULL)
);
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_type_check" CHECK (
    "connection_type" IN ('billing', 'payout', 'gift_card', 'crm')
);
