import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../database.mjs";
import { generate, generatePhotos, committed } from "../../scripts/export-d1-migrations.mjs";
import { dishPhotos } from "../dish-photos.mjs";

function schemaOf(db) {
  return db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all();
}

function inTempDatabase(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "zy-mig-"));
  try {
    return run(path.join(directory, "db.sqlite"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/**
 * The hand-written migrations after 0001/0002, each with the objects it
 * exists to create. `drop` rebuilds the database that migration was written
 * for: one deployed before those objects were added to 0001.
 */
const incremental = [
  { file: "0003_admin_password_gate.sql", drop: "DROP INDEX idx_admin_sessions_expiry; DROP TABLE admin_sessions; DROP TABLE admin_gate;" },
  { file: "0004_app_settings.sql", drop: "DROP TABLE app_settings;" }
].map((migration) => ({ ...migration, sql: readFileSync(path.join(migrationsDir, migration.file), "utf8") }))
  // The photo parts each create media_files, so each has to stand alone on a
  // database deployed before that table existed.
  .concat(committed().photos.map((part) => ({ file: part.name, drop: "DROP TABLE media_files;", sql: part.sql })));

test("the committed migrations match the schema and seed the server creates", () => {
  const generated = generate();
  const onDisk = committed();
  assert.equal(onDisk.schema, generated.schema, "migrations/0001_init.sql is stale — run: npm run d1:migrations");
  assert.equal(onDisk.catalog, generated.catalog, "migrations/0002_seed_catalog.sql is stale — run: npm run d1:migrations");
  assert.deepEqual(onDisk.photos, generatePhotos(), "the dish photo migrations are stale — run: npm run d1:migrations");
});

/**
 * Every dish photo reaches D1 as the same bytes, under the same URL the Node
 * server gives it, and a D1 database that already had pictures keeps them.
 */
test("the photo migrations give D1 the dishes' photos, byte for byte", () => {
  const sql = committed();
  const photos = dishPhotos();
  const migrated = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    // A dish the owner already gave a picture must not get a second one.
    if (photos.length) {
      db.prepare("INSERT INTO product_media (id, product_id, type, url, poster_url, sort_order, created_at) VALUES ('own', ?, 'image', '/media/own.jpg', NULL, 0, 'x')").run(photos[0].productId);
    }
    for (const part of sql.photos) db.exec(part.sql);
    const result = {
      media: db.prepare("SELECT product_id, url FROM product_media ORDER BY product_id, url").all(),
      files: db.prepare("SELECT id, bytes FROM media_files").all()
    };
    db.close();
    return result;
  });
  const seeded = inTempDatabase((file) => {
    createDatabase(file).close();
    const db = new DatabaseSync(file);
    const result = db.prepare("SELECT product_id, url FROM product_media ORDER BY product_id, url").all();
    db.close();
    return result;
  });

  // D1 refuses any single statement over 100 KB, and one photo is one statement.
  for (const part of sql.photos) {
    for (const statement of part.sql.split("\n")) assert.ok(statement.length < 100_000, `${part.name} has a ${statement.length}-byte statement`);
  }
  assert.equal(migrated.files.length, photos.length);
  for (const photo of photos) {
    const row = migrated.files.find((file) => file.id === photo.fileId);
    assert.ok(row, `${photo.fileId} is missing from D1`);
    assert.ok(Buffer.from(row.bytes).equals(photo.bytes), `${photo.fileId} changed on the way into D1`);
  }
  const withOwn = migrated.media.filter((item) => item.product_id === photos[0]?.productId);
  if (photos.length) assert.deepEqual(withOwn.map((item) => item.url), ["/media/own.jpg"]);
  // Apart from the dish given its own picture above, D1 and the Node server agree.
  assert.deepEqual(migrated.media.filter((item) => item.url !== "/media/own.jpg"), seeded.filter((item) => item.product_id !== photos[0]?.productId));
});

/**
 * The point of the migrations is that a D1 database ends up indistinguishable
 * from the one the Node server builds for itself. Applying them to an empty
 * SQLite file and diffing against that database is as close as this can be
 * checked without reaching Cloudflare.
 */
test("applying the migrations reproduces the server's database", () => {
  const sql = committed();

  const migrated = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    const result = {
      schema: schemaOf(db),
      products: db.prepare("SELECT * FROM products ORDER BY sort_order, id").all()
    };
    db.close();
    return result;
  });

  const seeded = inTempDatabase((file) => {
    createDatabase(file).close();
    const db = new DatabaseSync(file);
    const result = {
      schema: schemaOf(db),
      products: db.prepare("SELECT * FROM products ORDER BY sort_order, id").all()
    };
    db.close();
    return result;
  });

  assert.deepEqual(migrated.schema, seeded.schema);
  assert.equal(migrated.products.length, seeded.products.length);
  assert.ok(migrated.products.length > 100, `expected the full menu, got ${migrated.products.length}`);

  // Row timestamps are whenever each database was built; everything else has to
  // agree, the ids above all — an order placed from the app's bundled menu has
  // to name a product D1 knows.
  for (const [index, product] of migrated.products.entries()) {
    const { created_at: _c, updated_at: _u, ...actual } = product;
    const { created_at: _c2, updated_at: _u2, ...expected } = seeded.products[index];
    assert.deepEqual(actual, expected, `product ${product.sku} differs after migration`);
  }
});

/**
 * Wrangler applies each migration file once per database and never again, so
 * every hand-written migration meets two kinds of database in practice: one
 * created from today's 0001, which already has what it adds, and one deployed
 * before that existed, which does not. Both must end up where the Node server
 * does — the first untouched, the second brought up to date.
 */
test("the incremental migrations are no-ops on a fresh database and bring a deployed one up to date", () => {
  const sql = committed();
  const expected = inTempDatabase((file) => {
    createDatabase(file).close();
    const db = new DatabaseSync(file);
    const result = schemaOf(db);
    db.close();
    return result;
  });

  const fresh = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    for (const migration of incremental) db.exec(migration.sql);
    const result = schemaOf(db);
    db.close();
    return result;
  });
  assert.deepEqual(fresh, expected, "an incremental migration must not change a database created from today's 0001");

  for (const migration of incremental) {
    const deployed = inTempDatabase((file) => {
      const db = new DatabaseSync(file);
      db.exec(sql.schema);
      db.exec(sql.catalog);
      db.exec(migration.drop);
      db.exec(migration.sql);
      const result = schemaOf(db);
      db.close();
      return result;
    });
    assert.deepEqual(deployed, expected, `${migration.file} must give an already-deployed database what it adds`);
  }
});
