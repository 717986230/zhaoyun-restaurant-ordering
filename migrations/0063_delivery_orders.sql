-- Written by hand, not generated.
--
-- Orders from the delivery platforms, Lieferando and foodora
-- (shared/delivery.mjs, shared/delivery-store.mjs): once per platform and
-- platform id, so an order the platform sends twice is cooked once. The
-- customer's name, phone and address are blanked a month after. IF NOT
-- EXISTS, because 0001 (generated from the Node schema) already has them on
-- a new database.
CREATE TABLE IF NOT EXISTS delivery_orders (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      reference TEXT NOT NULL,
      status TEXT NOT NULL,
      type TEXT NOT NULL,
      placed_at TEXT,
      due_at TEXT,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      items_json TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
      paid_online INTEGER NOT NULL DEFAULT 1,
      test INTEGER NOT NULL DEFAULT 0,
      prep_minutes INTEGER,
      reject_reason TEXT,
      sync_status TEXT NOT NULL DEFAULT 'none',
      sync_error TEXT,
      synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (provider, external_id)
    );
CREATE INDEX IF NOT EXISTS idx_delivery_orders_created ON delivery_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON delivery_orders(status, created_at);
