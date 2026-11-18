-- E1 decision D5 (US1.2.3 F3): disabling a member is reversible and separate from removal.
ALTER TABLE "users" ADD COLUMN "disabled_at" TIMESTAMPTZ;
