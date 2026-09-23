-- Written by hand, not generated. A D1 database that has already applied 0001
-- never applies it again, so a table added there reaches only databases
-- created after it. This is how a deployed database gets the table that says
-- when a dish is on the menu (src/schedule.js); no row means always.
--
-- IF NOT EXISTS, so on a database created from today's 0001, which already
-- has the table, it is a no-op rather than a failure.
-- server/tests/d1-migrations.test.mjs checks both cases.

CREATE TABLE IF NOT EXISTS product_schedules (
      product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      schedule_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
