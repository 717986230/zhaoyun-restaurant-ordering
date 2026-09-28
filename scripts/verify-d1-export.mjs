/**
 * Checks a D1 export (`wrangler d1 export … --output backup.sql`) before it is
 * kept as a backup: the SQL loads into an empty SQLite database, the result
 * passes SQLite's own integrity check, and the tables a restaurant cannot
 * lose are there. A backup nobody has ever loaded is a hope, not a backup.
 *
 *   node scripts/verify-d1-export.mjs backup.sql
 *
 * Prints one JSON line with the row counts; exits non-zero on any failure.
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const REQUIRED_TABLES = ["products", "orders", "order_items", "receipts", "journal", "app_settings", "restaurant_tables"];

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/verify-d1-export.mjs <export.sql>");
  process.exit(2);
}

const database = new DatabaseSync(":memory:");
try {
  database.exec(readFileSync(file, "utf8"));
  const integrity = database.prepare("PRAGMA integrity_check").get().integrity_check;
  if (integrity !== "ok") throw new Error(`integrity check failed: ${integrity}`);
  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
  if (missing.length) throw new Error(`missing tables: ${missing.join(", ")}`);
  const counts = Object.fromEntries(REQUIRED_TABLES.map((table) => [table, database.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n]));
  if (!counts.products) throw new Error("the export has no dishes: that is not this restaurant's database");
  console.log(JSON.stringify({ ok: true, integrity, tables: tables.size, counts }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
} finally {
  database.close();
}
