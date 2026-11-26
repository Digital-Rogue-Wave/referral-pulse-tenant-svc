-- v5.2 DB Model §3 `tenants.widget_signing_secrets jsonb not null`: two active entries {kid, secret_encrypted,
-- created_at}; rotation keeps the previous one 7 days (API §3.17, US1.5.5). Replaces the single secret plus the
-- one-hour "previous" columns.
--
-- Backfill: the current secret becomes the newest entry under a fresh kid. A previous secret still inside its
-- old one-hour window is kept as the second entry, and the newest entry's created_at is set to that rotation
-- (window end minus one hour), so the previous one now verifies 7 days after it. A tenant with no secret gets a
-- plain 64-hex one, which the service seals on first read, as it already does for legacy rows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "tenants" ADD COLUMN "widget_signing_secrets" JSONB;

UPDATE "tenants" SET "widget_signing_secrets" =
    jsonb_build_array(jsonb_build_object(
        'kid', encode(gen_random_bytes(8), 'hex'),
        'secret_encrypted', COALESCE("widget_token_secret", encode(gen_random_bytes(32), 'hex')),
        'created_at', CASE
            WHEN "widget_token_secret_previous" IS NOT NULL AND "widget_token_secret_previous_until" > now()
            THEN to_jsonb("widget_token_secret_previous_until" - interval '1 hour')
            ELSE to_jsonb(now())
        END
    ))
    || CASE
        WHEN "widget_token_secret_previous" IS NOT NULL AND "widget_token_secret_previous_until" > now()
        THEN jsonb_build_array(jsonb_build_object(
            'kid', encode(gen_random_bytes(8), 'hex'),
            'secret_encrypted', "widget_token_secret_previous",
            'created_at', to_jsonb("widget_token_secret_previous_until" - interval '1 hour')
        ))
        ELSE '[]'::jsonb
    END;

-- The default only serves rows created outside the service (seed, test fixtures): no secret, no widget.
ALTER TABLE "tenants" ALTER COLUMN "widget_signing_secrets" SET DEFAULT '[]'::jsonb,
    ALTER COLUMN "widget_signing_secrets" SET NOT NULL;

ALTER TABLE "tenants"
    DROP COLUMN "widget_token_secret",
    DROP COLUMN "widget_token_secret_previous",
    DROP COLUMN "widget_token_secret_previous_until";
