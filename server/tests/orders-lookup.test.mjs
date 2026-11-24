import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "../database.mjs";

/**
 * The back office's bill lookup (store.searchReceipts): the same receipts the
 * register writes, narrowed by date, table, payment type, sale/storno and a
 * free-text match. Pure reads — nothing here changes a receipt.
 */

function openDatabase(context) {
  const directory = mkdtempSync(path.join(tmpdir(), "zy-orders-"));
  const database = createDatabase(path.join(directory, "db.sqlite"));
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
  return database;
}

async function sell(database, table, product, payment, requestId) {
  await database.createOrder({ clientRequestId: `order-${requestId}`, table, note: "", items: [{ id: product.id, qty: 1 }] });
  const bill = await database.billForTable(table);
  return database.checkout({
    clientRequestId: `pay-${requestId}`,
    table,
    items: bill.items.map((item) => ({ orderItemId: item.orderItemId, quantity: item.qty })),
    payments: [{ type: payment, amount: bill.total, tendered: bill.total }],
  }, "manager");
}

test("searchReceipts filters by table, payment, type, text and day range", async (context) => {
  const database = openDatabase(context);
  const products = await database.listProducts();
  const food = products.filter((product) => product.kind === "food" && product.available);
  const first = food[0];
  const second = food.find((product) => product.id !== first.id) ?? first;

  const a1 = await sell(database, "A1", first, "cash", "a1");
  const b2 = await sell(database, "B2", second, "card", "b2");
  const a1again = await sell(database, "A1", first, "cash", "a1b");

  // No filters: every receipt, newest first.
  const all = await database.searchReceipts({});
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((receipt) => receipt.receiptNo), [a1again.receiptNo, b2.receiptNo, a1.receiptNo]);

  // Null-ish fields (as the HTTP layer may hand them) are treated as absent,
  // not as the literal text "null".
  assert.equal((await database.searchReceipts({ q: null, from: null, to: null })).length, 3);

  // By table, case-insensitively.
  const onA1 = await database.searchReceipts({ table: "a1" });
  assert.deepEqual(onA1.map((receipt) => receipt.id).sort(), [a1.id, a1again.id].sort());

  // By payment type.
  const byCard = await database.searchReceipts({ payment: "card" });
  assert.deepEqual(byCard.map((receipt) => receipt.id), [b2.id]);
  const byCash = await database.searchReceipts({ payment: "cash" });
  assert.equal(byCash.length, 2);

  // Free text: the receipt number, the table, and a dish name on the bill.
  assert.deepEqual((await database.searchReceipts({ q: String(b2.receiptNo) })).map((receipt) => receipt.id), [b2.id]);
  assert.equal((await database.searchReceipts({ q: "B2" })).length, 1);
  const dishName = first.names.zh;
  if (dishName) {
    const byDish = await database.searchReceipts({ q: dishName });
    assert.ok(byDish.some((receipt) => receipt.id === a1.id), "a dish name on the bill matches");
  }

  // The restaurant's own days: today holds all three; a day long past holds none.
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  assert.equal((await database.searchReceipts({ from: today, to: today })).length, 3);
  assert.equal((await database.searchReceipts({ from: "2000-01-01", to: "2000-01-02" })).length, 0);

  // All three are sales; a storno is its own row the type filter picks out.
  assert.equal((await database.searchReceipts({ type: "sale" })).length, 3);
  assert.equal((await database.searchReceipts({ type: "storno" })).length, 0);
  await database.stornoReceipt(b2.id, "test", "manager");
  assert.equal((await database.searchReceipts({ type: "storno" })).length, 1);
  assert.equal((await database.searchReceipts({ type: "sale" })).length, 3);
  assert.equal((await database.searchReceipts({})).length, 4);

  // The cancelled sale now points at the storno that took it back.
  const cancelled = (await database.searchReceipts({ q: String(b2.receiptNo), type: "sale" }))[0];
  assert.ok(cancelled.cancelledBy, "the sale knows it was cancelled");
});

test("searchReceipts rejects a bad or over-long day range with a 400", async (context) => {
  const database = openDatabase(context);
  await assert.rejects(() => database.searchReceipts({ from: "not-a-date", to: "2026-01-01" }), (error) => error.status === 400);
});
