-- Written by hand, not generated (the statements are 0001's, as the Node
-- server creates them, each IF NOT EXISTS: 0001 already has them on a new
-- database).
--
-- The register (shared/register.mjs):
-- - receipts: never changed and never deleted. A storno is a receipt of its
--   own referring to the one it cancels, and only one may (the unique index).
-- - receipt_items: which order lines, and how many of each, a receipt paid.
-- - vouchers: value vouchers sold at the register, and what is left on each.
-- - day_closings: the day's closing (Z report) over a run of receipt numbers.
-- - journal: every business event in order, each entry chained to the one
--   before by its hash, so a change anywhere shows (the DEP 131 record).
--
-- The POS (shared/pos.mjs):
-- - pos_devices: the tablets and phones the manager paired.
-- - staff, pos_sessions: the waiters, their PINs (PBKDF2), their sign-ins.
-- - table_claims: which device has a table open (the table lock).
-- - order_staff: who ordered an order on the POS, and a takeaway's number.
-- - staff_settlements: each waiter's settlement at the end of a shift.

CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      receipt_no INTEGER NOT NULL UNIQUE,
      client_request_id TEXT NOT NULL UNIQUE,
      cash_register_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('sale','storno')),
      table_no TEXT,
      lines_json TEXT NOT NULL,
      vat_json TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      payments_json TEXT NOT NULL,
      refers_to TEXT REFERENCES receipts(id),
      reason TEXT,
      staff_role TEXT NOT NULL,
      fiscal_status TEXT NOT NULL DEFAULT 'unsigned',
      fiscal_json TEXT,
      created_at TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT
    );

CREATE TABLE IF NOT EXISTS receipt_items (
      receipt_id TEXT NOT NULL REFERENCES receipts(id),
      order_item_id TEXT NOT NULL REFERENCES order_items(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      PRIMARY KEY (receipt_id, order_item_id)
    );

CREATE TABLE IF NOT EXISTS vouchers (
      code TEXT PRIMARY KEY,
      value_cents INTEGER NOT NULL,
      balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
      sold_receipt_id TEXT NOT NULL REFERENCES receipts(id),
      voided_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS day_closings (
      id TEXT PRIMARY KEY,
      closing_no INTEGER NOT NULL UNIQUE,
      first_receipt_no INTEGER NOT NULL,
      last_receipt_no INTEGER NOT NULL UNIQUE,
      totals_json TEXT NOT NULL,
      staff_role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS pos_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT
    );

CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('staff','manager')),
      pin_hash TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      pin_iterations INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS pos_sessions (
      token_hash TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS table_claims (
      table_no TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT,
      expires_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS order_staff (
      order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      staff_id TEXT,
      staff_name TEXT,
      pickup_no INTEGER,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS staff_settlements (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      last_receipt_no INTEGER NOT NULL,
      totals_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE IF NOT EXISTS journal (
      seq INTEGER PRIMARY KEY,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT,
      payload_json TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_one_storno ON receipts(refers_to) WHERE refers_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receipt_items_item ON receipt_items(order_item_id);
