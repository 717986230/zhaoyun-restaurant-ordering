-- Written by hand, not generated.
--
-- Guests' own accounts, favourites and points (shared/customer.mjs), their
-- orders from the menu, and the tables a waiter opened for them to order
-- from (shared/ordering.mjs). Tables of their own, IF NOT EXISTS, because
-- 0001 (generated from the Node schema) already has them on a new database.
CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
CREATE TABLE IF NOT EXISTS customer_favorites (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (customer_id, product_id)
    );
CREATE TABLE IF NOT EXISTS points_ledger (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('earn','reverse','redeem','refund','adjust')),
      ref TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
CREATE TABLE IF NOT EXISTS guest_orders (
      order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
      channel TEXT NOT NULL CHECK (channel IN ('dine-in','pickup')),
      table_no TEXT NOT NULL,
      pickup_no INTEGER,
      payment TEXT NOT NULL DEFAULT 'in-store',
      points_spent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
CREATE TABLE IF NOT EXISTS table_sessions (
      table_no TEXT PRIMARY KEY,
      opened_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      staff_name TEXT
    );
CREATE INDEX IF NOT EXISTS idx_customer_sessions_expiry ON customer_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_points_ledger_customer ON points_ledger(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_points_ledger_ref ON points_ledger(ref, reason);
CREATE INDEX IF NOT EXISTS idx_guest_orders_table ON guest_orders(table_no, created_at);
CREATE INDEX IF NOT EXISTS idx_guest_orders_customer ON guest_orders(customer_id, created_at);
