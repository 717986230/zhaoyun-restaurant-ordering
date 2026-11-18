-- Written by hand, not generated.
--
-- 等叫/叫起 (hold/fire): a dish a waiter orders but holds back, so it is on the
-- bill at once yet reaches the kitchen only when the table is ready and the
-- waiter fires it (叫起). A row here marks a line as still held; firing deletes
-- the row and prints the dish. It never touches the price, the VAT rate or the
-- fiscal receipt. A line with no row here was sent to the kitchen as usual.
--    A table of its own, IF NOT EXISTS, because 0001 (generated from the Node
--    schema) already has it on a new database.
CREATE TABLE IF NOT EXISTS order_item_holds (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      held_at TEXT NOT NULL
    );
