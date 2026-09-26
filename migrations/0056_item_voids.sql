-- Written by hand, not generated.
--
-- Dishes taken off a bill after they went to the kitchen (退菜 / Storno vor
-- Bezahlung), each with its reason and who did it. The order stays as it
-- was sent; what is still to pay is ordered, less paid, less voided
-- (shared/register.mjs). A table of its own, IF NOT EXISTS, because 0001
-- (generated from the Node schema) already has it on a new database.
CREATE TABLE IF NOT EXISTS order_item_voids (
      id TEXT PRIMARY KEY,
      order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL,
      table_no TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      amount_cents INTEGER NOT NULL,
      reason TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT,
      created_at TEXT NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_order_item_voids_item ON order_item_voids(order_item_id);
CREATE INDEX IF NOT EXISTS idx_order_item_voids_staff ON order_item_voids(staff_id, created_at);
