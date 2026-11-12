-- Written by hand, not generated.
--
-- 会员生日 (生日营销, shared/customer.mjs): the member's birthday kept as a month
-- and day only — never the year, so no age or full date of birth is stored. The
-- owner switches the birthday perk on in settings; a member enters their own
-- birthday in their account. In their birthday month the till offers them the
-- birthday discount, through the same whole-bill discount a tier uses, so the
-- fiscal record is unchanged.
--
-- A table of its own rather than a column on customers, because a deployed D1
-- takes a new table safely (CREATE TABLE IF NOT EXISTS is a no-op where it
-- exists) but not a new column. IF NOT EXISTS, because 0001 (generated from the
-- Node schema) already has it on a new database.
CREATE TABLE IF NOT EXISTS member_birthdays (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
      updated_at TEXT NOT NULL
    );
