-- R-PRT-02's legal envelope for platform-sent invitations, which had no home in this service.
--
-- `invitation_channel` is Owner-only and nullable on purpose: null means "the Owner has not chosen",
-- which resolves to the platform default derived from `billing_country` — forbidden for German
-- tenants (BGH 2013, Empfehlungs-E-Mail treats platform-sent tell-a-friend mail as unsolicited
-- advertising attributable to the company), allowed elsewhere. Storing the derived value instead
-- would freeze a jurisdiction answer at provisioning time and lose the distinction between "not
-- chosen" and "chosen allowed".
--
-- `billing_country` is the input that rule needs and that nothing in this service held.
ALTER TABLE "tenants" ADD COLUMN "billing_country" CHAR(2);
ALTER TABLE "tenants" ADD COLUMN "invitation_channel" VARCHAR(20);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_invitation_channel_check"
    CHECK ("invitation_channel" IS NULL OR "invitation_channel" IN ('allowed', 'forbidden'));
