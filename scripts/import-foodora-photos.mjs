/**
 * Puts the restaurant's own dish photos from its foodora page in place of the
 * Wikimedia Commons ones, for the dishes scripts/foodora-photos.json lists.
 *
 *   node scripts/import-foodora-photos.mjs
 *
 * Each photo goes through the same 480×360 / 45 KB shrink as every other dish
 * photo, into server/dish-photos/<product id>.jpg, and its credits.json entry
 * says it came from foodora — which scripts/fetch-dish-photos.mjs then leaves
 * alone. Run `npm run d1:migrations` and `npm run catalog:bundle` afterwards:
 * the migrations carry the new photos to D1, replacing the old ones there.
 *
 * Behind a proxy, run it with NODE_USE_ENV_PROXY=1 so fetch uses HTTPS_PROXY.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shrink } from "./photo-shrink.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "server", "dish-photos");
const creditsFile = path.join(outDir, "credits.json");
const VENDOR_PAGE = "https://www.foodora.at/restaurant/ymou/chiri-kitchen";

const wanted = JSON.parse(readFileSync(path.join(root, "scripts", "foodora-photos.json"), "utf8"));
delete wanted._comment;
const credits = JSON.parse(readFileSync(creditsFile, "utf8"));

const failures = [];
for (const [id, want] of Object.entries(wanted)) {
  if (!credits[id]) {
    failures.push(`${id}: not a dish with a photo`);
    continue;
  }
  if (credits[id].source === "foodora" && credits[id].url === want.url) continue;
  try {
    const response = await fetch(want.url);
    if (!response.ok) throw new Error(`download ${response.status} ${want.url}`);
    const jpeg = await shrink(Buffer.from(await response.arrayBuffer()));
    writeFileSync(path.join(outDir, `${id}.jpg`), jpeg);
    credits[id] = {
      source: "foodora",
      title: want.title,
      url: want.url,
      page: VENDOR_PAGE,
      author: "Chiri Kitchen",
      license: null,
      bytes: jpeg.length
    };
    console.log(`${id}: ${want.title} (${jpeg.length} B)`);
  } catch (error) {
    failures.push(`${id}: ${error.message}`);
  }
}

writeFileSync(creditsFile, `${JSON.stringify(credits, null, 2)}\n`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
