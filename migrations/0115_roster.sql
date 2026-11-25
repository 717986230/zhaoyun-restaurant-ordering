-- Written by hand, not generated.
--
-- 员工排班 (shared/roster.mjs): the shifts a waiter is rostered for — a date and
-- a time window on the restaurant's wall clock, with an optional note. A table
-- of its own, new with this migration, so a deployed D1 is simply given it.
-- IF NOT EXISTS, because a database built from today's 0001 already has it.
-- Mirrors the roster_shifts table in server/database.mjs.
CREATE TABLE IF NOT EXISTS roster_shifts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL,
      start_min INTEGER NOT NULL,
      end_min INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_roster_shifts_date ON roster_shifts(tenant_id, work_date);
