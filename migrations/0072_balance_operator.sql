-- Written by hand, not generated.
--
-- Who booked each balance change (会员储值操作人; shared/customer.mjs): keyed by
-- the balance_ledger entry's id. A counter top-up or a manager's hand-adjust
-- records the staff who made it, so a member's stored-value ledger is a full
-- audit trail and no free credit can be slipped in untraceably. A table of its
-- own rather than a column on balance_ledger, because a deployed D1 can be
-- given a new table safely but not a new column (SQLite has no ADD COLUMN IF
-- NOT EXISTS, and 0001 is regenerated from the Node schema, so a later ADD
-- COLUMN would collide on a fresh deploy). IF NOT EXISTS, because 0001 already
-- has it on a new database.
CREATE TABLE IF NOT EXISTS balance_operators (
      ledger_id TEXT PRIMARY KEY,
      operator TEXT NOT NULL DEFAULT ''
    );
