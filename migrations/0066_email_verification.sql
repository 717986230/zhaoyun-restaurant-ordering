-- Written by hand, not generated.
--
-- A guest's email address proved by a code before they may book a table
-- (shared/email-verify.mjs, shared/mail.mjs): the codes sent, only their
-- hashes; the addresses proved; and mail_outbox, where MAIL_OUTBOX keeps
-- messages for the tests instead of sending them. IF NOT EXISTS, because
-- 0001 (generated from the Node schema) already has these on a new database.
CREATE TABLE IF NOT EXISTS email_codes (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_email_codes_customer ON email_codes(customer_id, created_at);
CREATE TABLE IF NOT EXISTS customer_verified_emails (
      customer_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      verified_at TEXT NOT NULL
    );
CREATE TABLE IF NOT EXISTS mail_outbox (
      id TEXT PRIMARY KEY,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
