-- Written by hand, not generated.
--
-- Members' stored value (会员储值, shared/customer.mjs): the running balance and
-- the ledger it is the sum of. Tables of their own rather than a column on
-- customers, because a deployed D1 can be given a new table safely (CREATE
-- TABLE IF NOT EXISTS is a no-op where it exists) but not a new column, and
-- SQLite has no ADD COLUMN IF NOT EXISTS. IF NOT EXISTS, because 0001
-- (generated from the Node schema) already has them on a new database.
--
-- A top-up is the sale of a multi-purpose voucher (Mehrzweckgutschein): the
-- money is taken at 0% and the tax is due only when the balance is spent on
-- food or drink (shared/register.mjs). The balance may never go below zero, so
-- two bills spending the same balance cannot both be written.
CREATE TABLE IF NOT EXISTS member_balances (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
      updated_at TEXT NOT NULL
    );
CREATE TABLE IF NOT EXISTS balance_ledger (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      delta_cents INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('topup','bonus','spend','refund','adjust','reverse')),
      ref TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_balance_ledger_customer ON balance_ledger(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_balance_ledger_ref ON balance_ledger(ref, reason);
