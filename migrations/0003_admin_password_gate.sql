-- Written by hand, not generated. 0001 is regenerated from server/database.mjs
-- every time the schema changes, but a D1 database that has already applied
-- 0001 never applies it again — so a table added there reaches only databases
-- created after it. This file is how a deployed database gets the password
-- gate.
--
-- Every statement is IF NOT EXISTS, so on a database created from today's 0001,
-- which already has both tables, it is a no-op rather than a failure.
-- server/tests/d1-migrations.test.mjs checks both cases.

CREATE TABLE IF NOT EXISTS admin_gate (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);
