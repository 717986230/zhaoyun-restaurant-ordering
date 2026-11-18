/**
 * Dish-photo migration helper: move the photos out of the SQL migrations and
 * into object storage (or on-demand download), without touching history.
 *
 * WHAT THIS SCRIPT DOES
 *   Default (dry run): inventory only. It lists the photo migration files
 *   (migrations/0005~0011 and 0100~0106), the photos in server/dish-photos/,
 *   and the steps a real cutover needs, and prints them. It writes nothing
 *   and changes nothing.
 *
 *   With --apply: the same inventory, plus it verifies a backup exists first
 *   (--backup <path>, required) and writes a manifest
 *   (scripts/dish-photos-migration-report.json by default, or --out <path>)
 *   recording every photo file, its size and hash, the migration inventory,
 *   and the backup's path, size and sha256. The manifest is what a later
 *   cutover checks each photo against before any database row is touched.
 *
 * WHAT IT NEVER DOES
 *   It never edits or deletes a migration file, and never deletes database
 *   rows. There is no --delete option on purpose.
 *
 * WHY YOU CANNOT JUST DELETE THE PHOTO ROWS FROM THE OLD MIGRATIONS
 *   The migrations 0005~0011 and 0100~0106 already ran on every deployed
 *   database. A migration is applied once, by name: editing the file
 *   afterwards changes nothing on a database that already ran it (the bytes
 *   are already in media_files), so deleting the rows shrinks no deployed
 *   database at all. What it does break is a fresh database: a new install
 *   applies the edited files from scratch and ends up without the photos the
 *   menu expects (or with a different media_files content than every
 *   deployed database has), and the export check
 *   (scripts/verify-d1-export.mjs, which compares generated migrations
 *   against the committed ones) starts failing. History is append-only.
 *
 * THE CORRECT CUTOVER (manual steps; this script only prepares step 1-2)
 *   1. Back up first. D1: `npx wrangler d1 export zhaoyun-ordering --remote
 *      --output backup-<date>.sql`. Node server: copy the live sqlite file
 *      out of server/data/ while the server is stopped. Keep the backup
 *      until the cutover is verified on a fresh database.
 *   2. Upload server/dish-photos/*.jpg to object storage (e.g. Cloudflare
 *      R2) under the same file ids dishPhotos() already computes
 *      (`dish-<product>-<hash>.jpg`, server/dish-photos.mjs), and keep
 *      credits.json alongside as the attribution manifest. The hash in the
 *      name already cache-busts, so the URLs stay stable.
 *   3. Change serving (code change, not this script): /media/:id reads from
 *      object storage, falling back to the media_files bytes until the
 *      cutover is verified; the Node server seeds from the same URLs.
 *   4. Change the generator (code change, not this script):
 *      scripts/export-d1-migrations.mjs generatePhotos() /
 *      generatePhotoRefresh() must stop emitting hex-encoded bytes and emit
 *      URL references instead — or stop emitting photo migrations entirely.
 *      Until then, every `npm run d1:migrations` re-creates the 1.4 MB files.
 *   5. Only after 2-4 are live and a fresh database serves every photo from
 *      storage: a NEW forward migration (next number after 0109, never an
 *      edit to an old one) deletes media_files rows nothing points at any
 *      more — the same shape as 0107_remove_stock_photos.sql, which already
 *      removed the superseded stock photos that way. 0107 is the precedent:
 *      removal happens in a new migration, not by rewriting history.
 *   6. Fresh installs then get photos from object storage at seed time, and
 *      the ~20 MB of photo migrations stops growing. The old files stay in
 *      the repo as history; removing them from git history would rewrite
 *      every deployed database's migration record and is not worth it.
 *
 * USAGE
 *   node scripts/migrate-dish-photos.mjs [--apply --backup <path> [--out <path>]]
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "migrations");
const photosDir = path.join(root, "server", "dish-photos");
const defaultOut = path.join(
  root,
  "scripts",
  "dish-photos-migration-report.json",
);

// Photo migrations only: 0107_remove_stock_photos.sql is a removal, not bytes.
const PHOTO_MIGRATION = /^\d{4}_dish_photos(_\d+)?\.sql$/;
const PHOTO_HD_MIGRATION = /^01\d{2}_dish_photos_hd(_\d+)?\.sql$/;

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function inventory() {
  const migrations = readdirSync(migrationsDir)
    .filter(
      (name) => PHOTO_MIGRATION.test(name) || PHOTO_HD_MIGRATION.test(name),
    )
    .sort()
    .map((name) => {
      const file = path.join(migrationsDir, name);
      const sql = readFileSync(file, "utf8");
      return {
        name,
        bytes: statSync(file).size,
        photos: (sql.match(/INSERT OR IGNORE INTO media_files/g) ?? []).length,
      };
    });
  const photos = readdirSync(photosDir)
    .filter((name) => name.endsWith(".jpg"))
    .sort()
    .map((name) => {
      const file = path.join(photosDir, name);
      return { name, bytes: statSync(file).size, sha256: sha256(file) };
    });
  const creditsFile = path.join(photosDir, "credits.json");
  const credits = existsSync(creditsFile)
    ? Object.keys(JSON.parse(readFileSync(creditsFile, "utf8")))
    : [];
  return { migrations, photos, credited: credits.length };
}

function parseArgs(argv) {
  const args = { apply: false, backup: null, out: defaultOut };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--apply") args.apply = true;
    else if (argv[index] === "--backup") args.backup = argv[(index += 1)];
    else if (argv[index] === "--out") args.out = argv[(index += 1)];
    else if (argv[index] === "--help" || argv[index] === "-h") args.help = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      "Usage: node scripts/migrate-dish-photos.mjs [--apply --backup <path> [--out <path>]]",
    );
    console.log(
      "Default is a dry run: inventory and plan only, nothing written.",
    );
    return 0;
  }
  if (args.apply && !args.backup) {
    console.error(
      "Refusing --apply without --backup: back the database up first (see the header comment), then pass its path.",
    );
    return 1;
  }
  let backup = null;
  if (args.backup) {
    const file = path.resolve(args.backup);
    if (
      !existsSync(file) ||
      !statSync(file).isFile() ||
      statSync(file).size === 0
    ) {
      console.error(`Backup not found or empty: ${file}`);
      return 1;
    }
    if (file.startsWith(migrationsDir) || file.startsWith(photosDir)) {
      console.error(
        "The backup must not live inside migrations/ or server/dish-photos/.",
      );
      return 1;
    }
    backup = { path: file, bytes: statSync(file).size, sha256: sha256(file) };
  }

  const { migrations, photos, credited } = inventory();
  const migrationBytes = migrations.reduce((sum, part) => sum + part.bytes, 0);
  const photoBytes = photos.reduce((sum, photo) => sum + photo.bytes, 0);
  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: !args.apply,
    migrations: { files: migrations, totalBytes: migrationBytes },
    photos: {
      directory: "server/dish-photos",
      files: photos,
      totalBytes: photoBytes,
      credited,
    },
    backup,
  };

  console.log(
    `Photo migrations: ${migrations.length} files, ${(migrationBytes / 1_000_000).toFixed(1)} MB, ${migrations.reduce((sum, part) => sum + part.photos, 0)} photo rows`,
  );
  for (const part of migrations)
    console.log(
      `  ${part.name}  ${(part.bytes / 1024).toFixed(0)} KB  ${part.photos} photos`,
    );
  console.log(
    `Dish photos on disk: ${photos.length} files, ${(photoBytes / 1_000_000).toFixed(1)} MB, ${credited} credited in credits.json`,
  );
  if (args.apply) {
    console.log(
      `Backup verified: ${backup.path} (${backup.bytes} B, sha256 ${backup.sha256.slice(0, 16)}…)`,
    );
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      `Manifest written: ${path.resolve(args.out).startsWith(root) ? path.relative(root, args.out) : path.resolve(args.out)}`,
    );
    console.log(
      "Next: upload the photos to object storage and change the generator (steps 2-4 in the header comment). No migration file or database row was touched.",
    );
  } else {
    console.log(
      "Dry run: nothing written, nothing deleted. Re-run with --apply --backup <path> to verify a backup and write the manifest.",
    );
    console.log(
      "Note: deleting photo rows from the old migration files would not shrink any deployed database (they already ran) and would break fresh installs — see the header comment.",
    );
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
