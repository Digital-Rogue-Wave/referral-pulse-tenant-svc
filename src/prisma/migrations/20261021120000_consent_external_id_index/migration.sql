-- The consent registry is read on every touch event that carries a consent block, to decide whether
-- the signal changed anything (ConsentService.latestFor). A subject named only by
-- `invitee_external_id` had no index to read: `idx_consent_email` covers the hashed-email path and
-- `idx_consent_subject` the platform id, leaving the client's own identifier to a scan on a table that
-- grows with every subject.
CREATE INDEX "idx_consent_external_id" ON "consents"("tenant_id", "subject_external_id", "recorded_at" DESC);
