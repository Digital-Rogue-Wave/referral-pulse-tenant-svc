-- `pending` was missing from the receipt status CHECK, so the state the fan-out is designed around
-- could not be stored at all.
--
-- §V5.12 wrote the constraint as ('completed','partial','failed') from the schema comment, before the
-- fan-out existed. §V5.16 D5-10 then made "a target that cannot answer yet" a `pending` receipt
-- carrying its reason, which is the normal case today: five of the six erasure handlers are services
-- that are not running. Every one of those writes violated the CHECK, failed the job, and left the
-- fan-out stalled at the first unreachable target with no receipt for it — found by running it
-- against a stack where three targets were genuinely down (NOTE.md §V5.19).
ALTER TABLE "dsr_receipts" DROP CONSTRAINT "dsr_receipts_status_check";
ALTER TABLE "dsr_receipts" ADD CONSTRAINT "dsr_receipts_status_check"
    CHECK ("status" IN ('pending', 'completed', 'partial', 'failed'));
