-- The restaurant is replacing the seeded stock photos (freely licensed images
-- from Wikimedia Commons) with its own, so those dishes should show as awaiting
-- a photo until a real one is uploaded. Remove every dish image whose credit is
-- not one of the restaurant's own foodora photos. A photo the owner uploaded
-- and the app icons carry no credit (NULL), and `NULL NOT LIKE …` is never true,
-- so both are left untouched; videos are left untouched too.

DELETE FROM product_media
 WHERE type = 'image'
   AND url IN (SELECT '/media/' || id FROM media_files WHERE credit NOT LIKE '%foodora%');

-- The stock image bytes nothing points at any more.
DELETE FROM media_files
 WHERE credit NOT LIKE '%foodora%'
   AND NOT EXISTS (SELECT 1 FROM product_media WHERE url = '/media/' || media_files.id);
