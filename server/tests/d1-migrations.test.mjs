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

const gateMigration = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations", "0003_admin_password_gate.sql"),
  "utf8"
);

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
 * the two databases 0003 meets in practice are these: one created from today's
 * 0001, which already has the gate tables, and one deployed before the gate
 * existed, which does not. Both must end up where the Node server does.
 */
test("0003 is a no-op on a fresh database and brings a deployed one up to date", () => {
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
    db.exec(gateMigration);
    const result = schemaOf(db);
    db.close();
    return result;
  });
  assert.deepEqual(fresh, expected, "0003 must not change a database created from today's 0001");

  const deployed = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    // The shape of a D1 database that applied 0001 before the gate was added.
    db.exec("DROP INDEX idx_admin_sessions_expiry; DROP TABLE admin_sessions; DROP TABLE admin_gate;");
    db.exec(gateMigration);
    const result = schemaOf(db);
    db.close();
    return result;
  });
  assert.deepEqual(deployed, expected, "0003 must give an already-deployed database the gate tables");
});
