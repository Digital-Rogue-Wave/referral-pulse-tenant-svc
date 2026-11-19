-- v5.2 R-PRT-02 / Appendix A #79: the platform never emails an invitee, so there is no tenant-level
-- invitation channel. "Invite by email" is a campaign share tool (campaign-service `share_tools`).
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_invitation_channel_check";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "invitation_channel";
