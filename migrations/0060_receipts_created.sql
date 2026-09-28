-- Written by hand, not generated.
--
-- The sales report (shared/reports.mjs) reads receipts by date: an index for
-- that, so a year's report does not read the whole register. IF NOT EXISTS,
-- because 0001 (generated from the Node schema) already has it on a new database.
CREATE INDEX IF NOT EXISTS idx_receipts_created ON receipts(created_at);
