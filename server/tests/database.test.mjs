import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../database.mjs";
import { TAG_COLORS } from "../../src/tag-colors.js";

test("order writes wait for a busy write lock instead of failing immediately", async (context) => {
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

  const product = (await database.listProducts(true))[0];
  const order = (id) => database.createOrder({ clientRequestId: id, table: "05", note: "", items: [{ id: product.id, qty: 1 }] });

  agent.exec("BEGIN IMMEDIATE");

  const unconfigured = new DatabaseSync(databasePath);
  const failFast = Date.now();
  assert.throws(() => unconfigured.exec("BEGIN IMMEDIATE"), /database is locked/);
  assert.ok(Date.now() - failFast < 200, "a default connection gives up immediately");
  unconfigured.close();

  const waited = Date.now();
  await assert.rejects(order("busy-order-0001"), /database is locked/);
  assert.ok(Date.now() - waited >= 400, "the server connection retries for the configured busy timeout");

  agent.exec("ROLLBACK");
  assert.equal((await order("busy-order-0002")).table, "05");
});

test("a dish keeps a palette colour tag, and anything off-palette clears it", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-tagcolor-"));
  const database = createDatabase(path.join(directory, "restaurant.sqlite"));
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });

  const created = await database.saveProduct({
    sku: "TAG-1", kind: "food", category: "RAMEN",
    names: { zh: "颜色测试", de: "", en: "" }, price: 9.9, printStation: "kitchen",
    tagColor: TAG_COLORS[0]
  });
  assert.equal(created.tagColor, TAG_COLORS[0], "a palette colour is kept");

  const offPalette = await database.saveProduct({ tagColor: "#123456" }, created.id);
  assert.equal(offPalette.tagColor, null, "an off-palette value is dropped to none");

  const reset = await database.saveProduct({ tagColor: TAG_COLORS[3] }, created.id);
  assert.equal(reset.tagColor, TAG_COLORS[3]);
  const cleared = await database.saveProduct({ tagColor: "" }, created.id);
  assert.equal(cleared.tagColor, null, "an empty value clears the tag");
});
