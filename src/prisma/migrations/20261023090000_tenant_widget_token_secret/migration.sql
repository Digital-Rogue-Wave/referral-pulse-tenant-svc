-- API Contract §4.1: the widget identity token is "a server-generated JWT from the client's backend
-- (signed with a shared secret). Our backend verifies the signature, extracts user identity".
--
-- A shared secret has two holders and the v5 suite describes neither's storage (CHANGELOG D-41), so
-- this column is the proposal recorded in `my-docs/cross-service-requirements.md` §1.11: one secret
-- per tenant, served to Event Ingestion over `GET /internal/tenants/{id}/widget-token-secret` under
-- its own `widget_secret.read` capability.
--
-- Per tenant, not platform-wide: a token minted by one client's backend must not render another
-- client's widget.
--
-- Backfilled for existing tenants rather than left null. Ingestion fails closed — no secret, no
-- widget — so a null here would mean a tenant whose widget silently never renders, and the whole
-- point of this change is that the widget works. `gen_random_bytes` is pgcrypto, already required by
-- this database for the API-key hashing; 32 bytes is the HMAC-SHA256 block size, hex-encoded to 64
-- characters.
--
-- Nullable so that tenant creation can set it in application code (where rotation will also live)
-- rather than relying on a database default that bypasses the service.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "widget_token_secret" CHAR(64);

UPDATE "tenants"
SET "widget_token_secret" = encode(gen_random_bytes(32), 'hex')
WHERE "widget_token_secret" IS NULL;
