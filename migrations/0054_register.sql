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
      created_at TEXT NOT NULL
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
