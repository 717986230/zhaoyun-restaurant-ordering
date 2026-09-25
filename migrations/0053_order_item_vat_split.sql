-- Written by hand, not generated.
--
-- 1. How an order line's price divides over the VAT rates, for the lines
--    over more than one: a set menu of ramen and a soft drink is partly 10%
--    and partly 20%. Worked out when the order is written (shared/rules.mjs,
--    vatSplit) and kept, so a later change of price or rate never rewrites an
--    old order. A line with no row here is all at its own vat_percent.
--    A table of its own, IF NOT EXISTS, because 0001 (generated from the Node
--    schema) already has it on a new database.
CREATE TABLE IF NOT EXISTS order_item_vat_splits (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      split_json TEXT NOT NULL
    );

-- 2. Until now the Worker neither saved a dish's VAT rate nor wrote it onto
--    an order line: every dish made in the console, drinks included, stood at
--    the column's 10%, and so did every line ordered. A drink at 10% is a
--    mistake only that could have made, never an owner's choice — so drinks
--    go to the 20% they should have had. Anything else the owner now sets in
--    the console, where the rate is finally kept.
UPDATE products SET vat_percent = 20 WHERE kind = 'drink' AND vat_percent = 10;

-- 3. The lines of bills not yet settled take their dish's rate, so the next
--    bill printed is right. Settled bills are history and stay as they were.
UPDATE order_items SET vat_percent = (SELECT products.vat_percent FROM products WHERE products.id = order_items.product_id)
WHERE order_id IN (SELECT id FROM orders WHERE billed_at IS NULL)
  AND EXISTS (SELECT 1 FROM products WHERE products.id = order_items.product_id);
