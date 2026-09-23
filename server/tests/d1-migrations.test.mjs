import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../database.mjs";
import { generate, committed } from "../../scripts/export-d1-migrations.mjs";

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
].map((migration) => ({ ...migration, sql: readFileSync(path.join(migrationsDir, migration.file), "utf8") }));

test("the committed migrations match the schema and seed the server creates", () => {
  const generated = generate();
  const onDisk = committed();
  assert.equal(onDisk.schema, generated.schema, "migrations/0001_init.sql is stale — run: npm run d1:migrations");
  assert.equal(onDisk.catalog, generated.catalog, "migrations/0002_seed_catalog.sql is stale — run: npm run d1:migrations");
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
