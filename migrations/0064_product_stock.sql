-- Written by hand, not generated.
--
-- Portions a dish has left today (每日限量; shared/stock.mjs): the portions
-- each day starts with, and what is left on the restaurant day under way. A
-- table of its own rather than columns on products, so no ALTER is needed on
-- a deployed database. IF NOT EXISTS, because 0001 (generated from the Node
-- schema) already has it on a new database.
CREATE TABLE IF NOT EXISTS product_stock (
      product_id TEXT PRIMARY KEY,
      daily_limit INTEGER,
      stock_day TEXT,
      stock_left INTEGER,
      updated_at TEXT NOT NULL
    );
