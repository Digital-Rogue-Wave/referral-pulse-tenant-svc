-- US1.5.4 F3 + F5: the widget-token secret is encrypted at rest and can be rotated.
--
-- `widget_token_secret` widens from CHAR(64) to TEXT to hold the AES-256-GCM form
-- (base64 of iv ‖ tag ‖ ciphertext, the layout `ProviderSecretCipher` already uses for provider secrets).
-- Existing rows keep their plain 64-hex value: the encryption key lives in the application, not in the
-- database, so the service seals a legacy value the first time it reads it instead of a SQL backfill.
--
-- After a rotation the replaced secret stays valid for one hour (the longest a widget token lives), so a
-- client's backend can switch over without a broken widget. Both columns are null outside that window.

ALTER TABLE "tenants" ALTER COLUMN "widget_token_secret" TYPE TEXT;

ALTER TABLE "tenants"
    ADD COLUMN IF NOT EXISTS "widget_token_secret_previous" TEXT,
    ADD COLUMN IF NOT EXISTS "widget_token_secret_previous_until" TIMESTAMPTZ;
