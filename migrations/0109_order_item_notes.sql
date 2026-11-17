-- Written by hand, not generated.
--
-- A per-dish kitchen note (逐菜备注): a free line the waiter writes under a
-- dish when ordering, such as "少盐" or "不要香菜". It is kept next to the
-- order line and prints under the dish on the kitchen ticket; it never touches
-- the price, the VAT rate or the fiscal receipt. A line with no row here has
-- no note.
--    A table of its own, IF NOT EXISTS, because 0001 (generated from the Node
--    schema) already has it on a new database.
CREATE TABLE IF NOT EXISTS order_item_notes (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      note TEXT NOT NULL
    );
