import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
