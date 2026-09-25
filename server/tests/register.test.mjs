import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../database.mjs";
import { vatSplit } from "../../shared/rules.mjs";

/**
 * The journal is only worth anything if a change to it shows. Each entry
 * carries the hash of the one before, so an entry edited, removed or put in
 * between breaks the check from that entry on.
 */
test("the journal shows an entry changed or removed afterwards", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "zy-journal-"));
  const file = path.join(directory, "db.sqlite");
  try {
    const database = createDatabase(file);
    const dish = database.listProducts().find((product) => product.sku === "R1");
    for (const n of [1, 2, 3]) database.createOrder({ clientRequestId: `journal-${n}`, table: "05", note: "", items: [{ id: dish.id, qty: n }] });
    const day = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const intact = await database.exportJournal(day, tomorrow);
    assert.equal(intact.entries.length, 3);
    assert.deepEqual(intact.verification, { ok: true, brokenAt: null, reason: null });
    database.close();

    // Someone edits the second order's quantity straight in the database.
    const raw = new DatabaseSync(file);
    raw.exec("UPDATE journal SET payload_json = replace(payload_json, '\"quantity\":2', '\"quantity\":1') WHERE seq = 2");
    raw.close();
    let reopened = createDatabase(file);
    assert.deepEqual((await reopened.exportJournal(day, tomorrow)).verification, { ok: false, brokenAt: 2, reason: "content" });
    reopened.close();

    // And removing it instead leaves a gap in the chain.
    const again = new DatabaseSync(file);
    again.exec("DELETE FROM journal WHERE seq = 2");
    again.close();
    reopened = createDatabase(file);
    assert.deepEqual((await reopened.exportJournal(day, tomorrow)).verification, { ok: false, brokenAt: 3, reason: "chain" });
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a set menu's split adds up to its price to the cent, whatever the proportions", () => {
  const rows = new Map([
    ["food", { vat_percent: 10, price_cents: 1290 }],
    ["drink", { vat_percent: 20, price_cents: 390 }],
    ["wine", { vat_percent: 20, price_cents: 620 }]
  ]);
  const set = { vat_percent: 10, bundle_items_json: JSON.stringify([{ productId: "food", quantity: 2 }, { productId: "drink", quantity: 1 }, { productId: "wine", quantity: 1 }]) };
  for (const price of [1, 99, 2999, 3333, 10001]) {
    const split = vatSplit(set, rows, price);
    assert.equal(split.reduce((sum, part) => sum + part.cents, 0), price, `${price}`);
  }
  // 2 × 12.90 food against 3.90 + 6.20 drinks: 25.80 to 10.10 of 35.90.
  assert.deepEqual(vatSplit(set, rows, 3590), [{ percent: 10, cents: 2580 }, { percent: 20, cents: 1010 }]);
  // A plain dish is its own rate; a set whose dishes are gone keeps its own.
  assert.deepEqual(vatSplit({ vat_percent: 20 }, rows, 450), [{ percent: 20, cents: 450 }]);
  assert.deepEqual(vatSplit({ vat_percent: 10, bundle_items_json: '[{"productId":"gone","quantity":1}]' }, rows, 450), [{ percent: 10, cents: 450 }]);
});
