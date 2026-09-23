/**
 * Finds a photo for every dish on Wikimedia Commons and keeps a small copy.
 *
 * Commons, because every file there carries a licence that allows a restaurant
 * to show it — and says who took it, which the menu then credits. Anything
 * non-commercial or no-derivatives is skipped: the photo is cropped, and the
 * menu is a business.
 *
 * What to search for lives in scripts/dish-photos.json. A dish is fetched again
 * only when its entry there changes (or its file is missing), so correcting one
 * wrong photo does not reshuffle the other hundred. Output:
 *
 *   server/dish-photos/<product id>.jpg   480×360, at most ~45 KB
 *   server/dish-photos/credits.json       who, which licence, where from
 *
 * The images go into D1 through the migration scripts/export-dish-photos.mjs
 * writes from these files; the Node server seeds them from the same place.
 *
 * Runs in GitHub Actions (.github/workflows/dish-photos.yml): it needs the open
 * internet, which a development sandbox may not have.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "server", "dish-photos");
const creditsFile = path.join(outDir, "credits.json");
const wanted = JSON.parse(readFileSync(path.join(root, "scripts", "dish-photos.json"), "utf8"));
delete wanted._comment;

const API = "https://commons.wikimedia.org/w/api.php";
// Wikimedia asks every client to say who it is.
const USER_AGENT = "zhaoyun-menu-photos/1.0 (https://github.com/717986230/zhaoyun-restaurant-ordering)";
const MAX_BYTES = 45_000;
const FREE = /^(cc0|public domain|pd|cc by(-sa)? \d(\.\d)?( [a-z]+)?|cc-by(-sa)?-\d)/i;
const NOT_FREE = /\b(nc|nd)\b|non-?commercial|no-?deriv/i;

function stripHtml(value = "") {
  return String(value).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (response.ok) return response.json();
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw new Error(`Commons API failed: ${url}`);
}

const INFO = {
  prop: "imageinfo",
  iiprop: "url|size|mime|extmetadata",
  iiurlwidth: "640",
  iiextmetadatafilter: "LicenseShortName|Artist|LicenseUrl"
};

/** Usable files for a search, best first. */
async function candidates(query) {
  const data = await api({ action: "query", generator: "search", gsrsearch: `${query} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "30", ...INFO });
  const pages = (data.query?.pages ?? []).sort((a, b) => a.index - b.index);
  return pages.map(describe).filter(Boolean);
}

async function pinned(title) {
  const data = await api({ action: "query", titles: title, ...INFO });
  const found = describe(data.query?.pages?.[0] ?? {}, true);
  if (!found) throw new Error(`${title} is missing or not freely licensed`);
  return found;
}

function describe(page, trusted = false) {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const license = stripHtml(meta.LicenseShortName?.value);
  if (!FREE.test(license) || NOT_FREE.test(license)) return null;
  if (!/^image\/(jpeg|png|webp)$/.test(info.mime)) return null;
  const ratio = info.width / info.height;
  if (!trusted && (info.width < 500 || ratio < 0.7 || ratio > 2.2)) return null;
  return {
    file: page.title,
    page: info.descriptionurl,
    thumb: info.thumburl || info.url,
    author: stripHtml(meta.Artist?.value) || "Unknown",
    license,
    licenseUrl: stripHtml(meta.LicenseUrl?.value) || null
  };
}

/**
 * 480×360 and at most MAX_BYTES: hex-encoded, one photo is one SQL statement
 * in the D1 migration, and D1 refuses a statement over 100 KB.
 */
async function shrink(buffer) {
  for (const width of [480, 400]) {
    for (let quality = 78; quality >= 36; quality -= 6) {
      const out = await sharp(buffer).rotate().resize(width, (width * 3) / 4, { fit: "cover", position: "attention" }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (out.length <= MAX_BYTES) return out;
    }
  }
  throw new Error(`cannot get the photo under ${MAX_BYTES} bytes`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const credits = existsSync(creditsFile) ? JSON.parse(readFileSync(creditsFile, "utf8")) : {};
  const force = process.env.FORCE === "1";
  const cache = new Map();
  const failures = [];
  let fetched = 0;

  for (const [id, want] of Object.entries(wanted)) {
    const have = credits[id];
    const unchanged = have && have.query === want.query && (have.pick ?? 0) === (want.pick ?? 0) && (have.pinned ?? null) === (want.file ?? null);
    if (!force && unchanged && existsSync(path.join(outDir, `${id}.jpg`))) continue;

    try {
      // Two dishes never share a picture unless someone pinned it that way.
      const taken = new Set(Object.entries(credits).filter(([other]) => other !== id).map(([, credit]) => credit.file));
      let chosen;
      let ranked = [];
      if (want.file) {
        chosen = await pinned(want.file);
      } else {
        if (!cache.has(want.query)) cache.set(want.query, await candidates(want.query));
        ranked = cache.get(want.query);
        const free = ranked.filter((candidate) => !taken.has(candidate.file));
        chosen = free[want.pick ?? 0] ?? free[0];
        if (!chosen) throw new Error(`nothing usable for "${want.query}"`);
      }
      const response = await fetch(chosen.thumb, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) throw new Error(`download ${response.status} ${chosen.thumb}`);
      const jpeg = await shrink(Buffer.from(await response.arrayBuffer()));
      writeFileSync(path.join(outDir, `${id}.jpg`), jpeg);
      credits[id] = {
        query: want.query ?? null,
        pick: want.pick ?? 0,
        pinned: want.file ?? null,
        file: chosen.file,
        page: chosen.page,
        author: chosen.author,
        license: chosen.license,
        licenseUrl: chosen.licenseUrl,
        bytes: jpeg.length,
        // The next few, so a wrong photo can be swapped by naming one.
        alternatives: ranked.filter((candidate) => candidate.file !== chosen.file).slice(0, 5).map((candidate) => candidate.file)
      };
      fetched += 1;
      console.log(`${id}: ${chosen.file} (${jpeg.length} B, ${chosen.license})`);
    } catch (error) {
      failures.push(`${id}: ${error.message}`);
      console.error(`${id}: ${error.message}`);
    }
  }

  const ordered = Object.fromEntries(Object.keys(wanted).filter((id) => credits[id]).map((id) => [id, credits[id]]));
  writeFileSync(creditsFile, `${JSON.stringify(ordered, null, 2)}\n`);
  console.log(`fetched ${fetched}, ${Object.keys(ordered).length}/${Object.keys(wanted).length} dishes have a photo`);
  if (failures.length) console.log(`::warning::${failures.length} dishes without a photo:\n${failures.join("\n")}`);
}

await main();
