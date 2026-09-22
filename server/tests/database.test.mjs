import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../database.mjs";

test("order writes wait for a busy write lock instead of failing immediately", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-sqlite-"));
  const databasePath = path.join(directory, "restaurant.sqlite");
  const database = createDatabase(databasePath, { busyTimeoutMs: 500 });
  // A print agent in another process holds the write lock for a moment.
  const agent = new DatabaseSync(databasePath);
  context.after(() => {
    agent.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const product = database.listProducts(true)[0];
  const order = (id) => database.createOrder({ clientRequestId: id, table: "05", note: "", items: [{ id: product.id, qty: 1 }] });

  agent.exec("BEGIN IMMEDIATE");

  const unconfigured = new DatabaseSync(databasePath);
  const failFast = Date.now();
  assert.throws(() => unconfigured.exec("BEGIN IMMEDIATE"), /database is locked/);
  assert.ok(Date.now() - failFast < 200, "a default connection gives up immediately");
  unconfigured.close();

  const waited = Date.now();
  assert.throws(() => order("busy-order-0001"), /database is locked/);
  assert.ok(Date.now() - waited >= 400, "the server connection retries for the configured busy timeout");

  agent.exec("ROLLBACK");
  assert.equal(order("busy-order-0002").table, "05");
});
