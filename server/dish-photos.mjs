/**
 * The photos scripts/fetch-dish-photos.mjs keeps in server/dish-photos/, read
 * as rows for the media table.
 *
 * Both backends store these as bytes in their database — the Node server seeds
 * them from here, D1 gets them from the migration exported from the same
 * list — so a photo is one row wherever the menu runs, and replacing one is a
 * database write rather than a deploy.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DISH_PHOTO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "dish-photos");

/** "Jane Doe · CC BY-SA 4.0 · Wikimedia Commons" — what the menu prints under the photo. */
export function creditLine(credit) {
  return [credit.author, credit.license, "Wikimedia Commons"].filter(Boolean).join(" · ");
}

/**
 * One entry per dish that has a photo, in the order the list gives them. The
 * file id carries a hash of the bytes, so a replaced photo gets a new URL and
 * a browser that cached the old one for a year still sees the new one.
 */
export function dishPhotos(directory = DISH_PHOTO_DIR) {
  const creditsFile = path.join(directory, "credits.json");
  if (!existsSync(creditsFile)) return [];
  const credits = JSON.parse(readFileSync(creditsFile, "utf8"));
  return Object.entries(credits).flatMap(([productId, credit]) => {
    const file = path.join(directory, `${productId}.jpg`);
    if (!existsSync(file)) return [];
    const bytes = readFileSync(file);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
    return [{
      productId,
      fileId: `dish-${productId}-${hash}.jpg`,
      contentType: "image/jpeg",
      bytes,
      credit: creditLine(credit),
      sourceUrl: credit.page || null
    }];
  });
}
