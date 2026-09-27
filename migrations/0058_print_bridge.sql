-- Written by hand, not generated.
--
-- The print bridges in the restaurant (server/print-agent.mjs) and what each
-- last found at its printers, for the console to show which printer is
-- answering. Tables of their own, IF NOT EXISTS, because 0001 (generated from
-- the Node schema) already has them on a new database.
CREATE TABLE IF NOT EXISTS print_bridges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL
    );
CREATE TABLE IF NOT EXISTS printer_status (
      printer_id TEXT PRIMARY KEY REFERENCES printer_profiles(id) ON DELETE CASCADE,
      bridge_id TEXT NOT NULL,
      ok INTEGER NOT NULL,
      error TEXT,
      checked_at TEXT NOT NULL
    );
