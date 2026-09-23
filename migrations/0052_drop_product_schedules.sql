-- Written by hand, not generated. Serving hours were briefly kept per dish
-- (0051); they belong to the promotions page and the set menus page as a
-- whole, and live in app_settings (featured_schedule, sets_schedule), which
-- needs no table of its own. This takes the per-dish table away again.
--
-- IF EXISTS, so it is a no-op on a database that never had it.
-- server/tests/d1-migrations.test.mjs checks both cases.

DROP TABLE IF EXISTS product_schedules;
