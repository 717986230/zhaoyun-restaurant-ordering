import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/**
 * Every exported *_SQL string in shared/ is compiled against the real D1 schema
 * (migrations/0001_init.sql). SQLite checks table and column names at prepare
 * time, so a query naming a column that does not exist (e.g. points_ledger has
 * `delta`, not `delta_cents`) fails here instead of on the live Worker.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("every shared SQL statement compiles against the D1 schema", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(root, "migrations", "0001_init.sql"), "utf8"));
  const sharedDir = path.join(root, "shared");
  let checked = 0;
  const failures = [];
  for (const file of readdirSync(sharedDir).filter((name) => name.endsWith(".mjs"))) {
    const module = await import(path.join(sharedDir, file));
    for (const [name, sql] of Object.entries(module)) {
      if (!name.endsWith("_SQL") || typeof sql !== "string") continue;
      checked += 1;
      // A few exports are WHERE-clause fragments shared by several statements.
      const statement = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE|CREATE)\b/i.test(sql) ? sql : `SELECT 1 WHERE ${sql}`;
      try { db.prepare(statement); } catch (error) { failures.push(`${file} ${name}: ${error.message}`); }
    }
  }
  db.close();
  assert.ok(checked > 20, `found ${checked} SQL statements`);
  assert.deepEqual(failures, []);
});
