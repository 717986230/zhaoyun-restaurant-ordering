-- Written by hand, not generated.
--
-- The restaurant's account (shared/account.mjs): registered once, signed in
-- with an account name and a password; the waiters are under it. It replaces
-- the one-password door (admin_gate, admin_sessions), which is emptied here:
-- a password set there becomes the account "admin" with the same password,
-- so the owner signs in as admin and may rename it in the settings. The old
-- sessions end, and everyone signs in once more.
-- Tables of their own, IF NOT EXISTS, because 0001 (generated from the Node
-- schema) already has them on a new database.
CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
CREATE TABLE IF NOT EXISTS account_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_account_sessions_expiry ON account_sessions(expires_at);

INSERT INTO accounts (id, login, name, password_hash, password_salt, password_iterations, created_at, updated_at)
SELECT 'owner', 'admin', 'Admin', password_hash, password_salt, password_iterations, updated_at, updated_at
FROM admin_gate WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM accounts);
DELETE FROM admin_gate;
DELETE FROM admin_sessions;
