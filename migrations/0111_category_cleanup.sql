-- Written by hand, not generated.
--
-- Tidies the menu's categories (2026-11-19): the seed (server/photo-menu.mjs)
-- already says this, and a fresh database gets it from migrations/0002; this
-- brings a deployed one up to date.
--
-- * CHIRI ROLLS was not a word: the nine inside-out rolls are uramaki, so the
--   category is URAMAKI ROLLS. Nothing else about the dishes changes.
-- * TEA held a single dish (photo-tea, jasmine/green/black in one); it joins
--   NON-ALCOHOLIC, where the guest menu already shows it (the drinks page
--   folds every drink category into one).
-- A category the owner renamed in the console is untouched: only rows still
-- carrying the old names move. To undo, rename the category in the console
-- (its dishes move with it).
UPDATE products
SET category = 'URAMAKI ROLLS', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE category = 'CHIRI ROLLS';
UPDATE products
SET category = 'NON-ALCOHOLIC', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE category = 'TEA';
