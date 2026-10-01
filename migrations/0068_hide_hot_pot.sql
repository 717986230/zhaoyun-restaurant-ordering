-- Written by hand, not generated.
--
-- Takes hot pot off the menu for now (先把火锅的标签隐藏): its four dishes and
-- the hot pot set for two are unpublished, so the guest menu no longer shows a
-- HOT POT tab or offers the set. Nothing is deleted — ticking "上架" on a dish
-- in the console brings it back, and with the first one the tab returns.
UPDATE products
SET published = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE published = 1 AND (category = 'HOT POT' OR id = 'set-hot-pot-for-two');
