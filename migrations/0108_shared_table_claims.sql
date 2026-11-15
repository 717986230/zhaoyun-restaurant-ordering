-- Written by hand, not generated.
--
-- Collaborative tables (many devices at one table) and a fencing token on the
-- table lock, kept beside table_claims rather than on it: a deployed D1 takes a
-- new table safely (CREATE TABLE IF NOT EXISTS is a no-op where it exists) but
-- not a new column, and SQLite has no ADD COLUMN IF NOT EXISTS — the same reason
-- 0069/0072 are side tables. IF NOT EXISTS, because 0001 (generated from the
-- Node schema) already has it on a new database.
--
-- `shared` = 1 lets several devices order and void on the table at once; what
-- keeps their writes from stepping on each other is the journal's optimistic
-- lock, not the table lock, so opening the lock up is safe (shared/store.mjs,
-- shared/pos.mjs). `epoch` climbs by one each time the table changes hands, so
-- a device whose 90-second hold lapsed cannot be mistaken for the one that
-- holds the table now.
CREATE TABLE IF NOT EXISTS table_claim_meta (
      table_no TEXT PRIMARY KEY,
      shared INTEGER NOT NULL DEFAULT 0,
      epoch INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT ''
    );
