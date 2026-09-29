-- Written by hand, not generated.
--
-- The cash drawer (Kassenlade; shared/drawer.mjs): a shift opened with its
-- float, money put in or taken out with why, and the count at the end
-- against what should be there. open_flag is 1 on the one open drawer and
-- NULL once counted, so UNIQUE lets only one be open. IF NOT EXISTS, because
-- 0001 (generated from the Node schema) already has these on a new database.
CREATE TABLE IF NOT EXISTS drawer_sessions (
      id TEXT PRIMARY KEY,
      open_flag INTEGER UNIQUE,
      after_receipt_no INTEGER NOT NULL,
      float_cents INTEGER NOT NULL,
      opened_by TEXT,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      closed_by TEXT,
      last_receipt_no INTEGER,
      counted_cents INTEGER,
      counts_json TEXT,
      totals_json TEXT,
      note TEXT
    );
CREATE INDEX IF NOT EXISTS idx_drawer_sessions_closed ON drawer_sessions(closed_at);
CREATE TABLE IF NOT EXISTS drawer_movements (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES drawer_sessions(id),
      kind TEXT NOT NULL CHECK (kind IN ('in','out')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      reason TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT,
      created_at TEXT NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_drawer_movements_session ON drawer_movements(session_id);
