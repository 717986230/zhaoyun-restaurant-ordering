import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../database.mjs";
import { vatSplit } from "../../shared/products.mjs";
import { closingTotals, planCheckout, planStorno } from "../../shared/register.mjs";

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
    const dish = (await database.listProducts()).find((product) => product.sku === "R1");
    for (const n of [1, 2, 3]) await database.createOrder({ clientRequestId: `journal-${n}`, table: "05", note: "", items: [{ id: dish.id, qty: n }] });
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

/**
 * A tip is the staff's: beside the payment, never in the receipt's total or
 * its VAT; a storno gives it back; the closing counts it apart.
 */
test("a tip stays out of the takings, and a storno takes it back", () => {
  const itemRows = [{ id: "i1", table_no: "05", status: "served", billed_at: null, quantity: 1, paid_quantity: 0, voided_quantity: 0, unit_price_cents: 1850, vat_percent: 10, product_name: "Ramen", modifiers_json: "[]" }];
  const settings = { cashRegisterId: "K1" };
  const { receipt } = planCheckout({ items: [{ orderItemId: "i1", quantity: 1 }], payments: [{ type: "cash", amount: 18.5, tendered: 50, tip: 1.5 }] }, { itemRows, voucherRows: [], receiptNo: 1, settings, role: "staff" });
  assert.equal(receipt.totalCents, 1850);
  assert.deepEqual(receipt.vat, [{ percent: 10, grossCents: 1850, netCents: 1682, vatCents: 168 }]);
  assert.deepEqual(receipt.payments, [{ type: "cash", amountCents: 1850, tipCents: 150, tenderedCents: 5000, changeCents: 3000 }]);
  assert.throws(() => planCheckout({ items: [{ orderItemId: "i1", quantity: 1 }], payments: [{ type: "voucher", amount: 18.5, tip: 1, voucherCode: "X" }] }, { itemRows, voucherRows: [], receiptNo: 1, settings, role: "staff" }), /cash or by card/);

  const [sale] = [receipt].map((planned) => ({ receipt_no: 1, type: "sale", total_cents: planned.totalCents, vat_json: JSON.stringify(planned.vat), payments_json: JSON.stringify(planned.payments), lines_json: JSON.stringify(planned.lines), cash_register_id: "K1", table_no: "05", id: planned.id }));
  const { receipt: storno } = planStorno(sale, { receiptNo: 2, reason: "wrong table", soldVoucherRows: [], role: "manager" });
  assert.deepEqual(storno.payments, [{ type: "cash", amountCents: -1850, tipCents: -150 }]);

  const closing = closingTotals([sale]);
  assert.equal(closing.grossCents, 1850);
  assert.equal(closing.cashCents, 1850);
  assert.deepEqual(closing.tips, { cash: 150, card: 0 });
  const both = closingTotals([sale, { receipt_no: 2, type: "storno", total_cents: storno.totalCents, vat_json: JSON.stringify(storno.vat), payments_json: JSON.stringify(storno.payments), lines_json: JSON.stringify(storno.lines) }]);
  assert.equal(both.tipsCents, 0);
});

/**
 * 单品折扣: a discount on one dish comes off only that dish's VAT rate, as a
 * negative line of its own that carries the dish and the reason — so the
 * receipt total and the tax split stay exact, and a discounted line must say
 * why (like a void).
 */
test("a per-item discount is scoped to its own dish and VAT rate, and says why", () => {
  const itemRows = [
    { id: "i1", product_id: "p1", table_no: "05", status: "served", billed_at: null, quantity: 1, paid_quantity: 0, voided_quantity: 0, unit_price_cents: 2000, vat_percent: 10, product_name: "Suppe", modifiers_json: "[]" },
    { id: "i2", product_id: "p2", table_no: "05", status: "served", billed_at: null, quantity: 1, paid_quantity: 0, voided_quantity: 0, unit_price_cents: 500, vat_percent: 20, product_name: "Bier", modifiers_json: "[]" }
  ];
  const settings = { cashRegisterId: "K1" };
  const common = { itemRows, voucherRows: [], receiptNo: 1, settings, role: "staff" };

  const { receipt } = planCheckout({
    discountReason: "Stammgast",
    items: [{ orderItemId: "i1", quantity: 1, discountPercent: 50 }, { orderItemId: "i2", quantity: 1 }],
    payments: [{ type: "cash", amount: 15 }]
  }, common);

  // 20.00 soup less 50% = 10.00, plus 5.00 beer: 15.00 to the cent.
  assert.equal(receipt.totalCents, 1500);
  // The 10€ off lands only on the 10% rate; the 20% beer is untouched.
  assert.deepEqual(receipt.vat, [
    { percent: 10, grossCents: 1000, netCents: 909, vatCents: 91 },
    { percent: 20, grossCents: 500, netCents: 417, vatCents: 83 }
  ]);
  const discount = receipt.lines.find((line) => line.kind === "discount");
  assert.equal(discount.orderItemId, "i1");
  assert.equal(discount.percent, 50);
  assert.equal(discount.reason, "Stammgast");
  assert.equal(discount.totalCents, -1000);
  assert.deepEqual(discount.vatSplit, [{ percent: 10, cents: -1000 }]);

  // A discounted line with no reason is refused.
  assert.throws(() => planCheckout({
    items: [{ orderItemId: "i1", quantity: 1, discountPercent: 50 }],
    payments: [{ type: "cash", amount: 10 }]
  }, common), /says why/);
});

/**
 * 赠菜: a comped dish is free — a negative line of its own (kind "comp") takes
 * its whole price off, at its own VAT rate, so the rest of the bill and the tax
 * split stay exact. A comp says why (like a void), and stands in for a discount
 * on the same line.
 */
test("a comped dish is taken off in full at its own VAT rate, and says why", () => {
  const itemRows = [
    { id: "i1", product_id: "p1", table_no: "05", status: "served", billed_at: null, quantity: 1, paid_quantity: 0, voided_quantity: 0, unit_price_cents: 2000, vat_percent: 10, product_name: "Suppe", modifiers_json: "[]" },
    { id: "i2", product_id: "p2", table_no: "05", status: "served", billed_at: null, quantity: 1, paid_quantity: 0, voided_quantity: 0, unit_price_cents: 1500, vat_percent: 10, product_name: "Schnitzel", modifiers_json: "[]" },
    { id: "i3", product_id: "p3", table_no: "05", status: "served", billed_at: null, quantity: 1, paid_quantity: 0, voided_quantity: 0, unit_price_cents: 500, vat_percent: 20, product_name: "Bier", modifiers_json: "[]" }
  ];
  const settings = { cashRegisterId: "K1" };
  const common = { itemRows, voucherRows: [], receiptNo: 1, settings, role: "staff" };

  const { receipt } = planCheckout({
    discountReason: "Küche entschuldigt sich",
    items: [{ orderItemId: "i1", quantity: 1, comp: true }, { orderItemId: "i2", quantity: 1 }, { orderItemId: "i3", quantity: 1 }],
    payments: [{ type: "cash", amount: 20 }]
  }, common);

  // The 20€ soup is free; 15€ schnitzel + 5€ beer remain: 20.00.
  assert.equal(receipt.totalCents, 2000);
  // The comp comes off only the 10% rate (the soup); the 20% beer is untouched.
  assert.deepEqual(receipt.vat, [
    { percent: 10, grossCents: 1500, netCents: 1364, vatCents: 136 },
    { percent: 20, grossCents: 500, netCents: 417, vatCents: 83 }
  ]);
  const comp = receipt.lines.find((line) => line.kind === "comp");
  assert.equal(comp.orderItemId, "i1");
  assert.equal(comp.reason, "Küche entschuldigt sich");
  assert.equal(comp.totalCents, -2000);
  assert.deepEqual(comp.vatSplit, [{ percent: 10, cents: -2000 }]);

  // A comp stands in for a discount on the same line: one comp line, no discount line.
  const { receipt: both } = planCheckout({
    discountReason: "gratis",
    items: [{ orderItemId: "i1", quantity: 1, comp: true, discountPercent: 50 }, { orderItemId: "i3", quantity: 1 }],
    payments: [{ type: "cash", amount: 5 }]
  }, common);
  assert.equal(both.lines.filter((line) => line.kind === "comp").length, 1);
  assert.equal(both.lines.filter((line) => line.kind === "discount").length, 0);
  assert.equal(both.totalCents, 500);

  // A comped line with no reason is refused.
  assert.throws(() => planCheckout({
    items: [{ orderItemId: "i1", quantity: 1, comp: true }, { orderItemId: "i3", quantity: 1 }],
    payments: [{ type: "cash", amount: 5 }]
  }, common), /says why/);
});

/**
 * 单品改价: the waiter sets a dish's unit price for this bill (a market price).
 * The new price is the line's own VAT base — a single-rate dish only — and a
 * later 单品折扣 comes off it; the list price and reason go to the journal. A
 * set menu's mixed rates are not the dish's to re-split.
 */
test("a dish is repriced at its own VAT rate, keeps its list price, and says why", () => {
  const itemRows = [
    { id: "i1", product_id: "p1", table_no: "05", status: "served", billed_at: null, quantity: 1, paid_quantity: 0, voided_quantity: 0, unit_price_cents: 2000, vat_percent: 10, product_name: "Fisch", modifiers_json: "[]" },
    { id: "i2", product_id: "p2", table_no: "05", status: "served", billed_at: null, quantity: 1, paid_quantity: 0, voided_quantity: 0, unit_price_cents: 500, vat_percent: 20, product_name: "Bier", modifiers_json: "[]" },
    { id: "i3", product_id: "p3", table_no: "05", status: "served", billed_at: null, quantity: 1, paid_quantity: 0, voided_quantity: 0, unit_price_cents: 1500, vat_percent: 10, product_name: "Menü", modifiers_json: "[]", vat_split_json: JSON.stringify([{ percent: 10, cents: 1000 }, { percent: 20, cents: 500 }]) }
  ];
  const settings = { cashRegisterId: "K1" };
  const common = { itemRows, voucherRows: [], receiptNo: 1, settings, role: "staff" };

  const { receipt } = planCheckout({
    discountReason: "Marktpreis",
    items: [{ orderItemId: "i1", quantity: 1, overridePriceCents: 2500 }, { orderItemId: "i2", quantity: 1 }],
    payments: [{ type: "cash", amount: 30 }]
  }, common);

  // The fish now charges 25.00; plus 5.00 beer: 30.00.
  assert.equal(receipt.totalCents, 3000);
  const fish = receipt.lines.find((line) => line.orderItemId === "i1" && line.kind === "item");
  assert.equal(fish.unitPriceCents, 2500);
  assert.equal(fish.totalCents, 2500);
  assert.equal(fish.listPriceCents, 2000);
  assert.equal(fish.reason, "Marktpreis");
  assert.deepEqual(fish.vatSplit, [{ percent: 10, cents: 2500 }]);
  assert.deepEqual(receipt.vat, [
    { percent: 10, grossCents: 2500, netCents: 2273, vatCents: 227 },
    { percent: 20, grossCents: 500, netCents: 417, vatCents: 83 }
  ]);

  // A 单品折扣 comes off the new price: 20% off 25.00 = a −5.00 line.
  const { receipt: cut } = planCheckout({
    discountReason: "Marktpreis, Stammgast",
    items: [{ orderItemId: "i1", quantity: 1, overridePriceCents: 2500, discountPercent: 20 }],
    payments: [{ type: "cash", amount: 20 }]
  }, common);
  assert.equal(cut.totalCents, 2000);
  assert.equal(cut.lines.find((line) => line.kind === "discount").totalCents, -500);

  // A price change with no reason is refused.
  assert.throws(() => planCheckout({
    items: [{ orderItemId: "i1", quantity: 1, overridePriceCents: 2500 }],
    payments: [{ type: "cash", amount: 25 }]
  }, common), /says why/);

  // A set menu's mixed rates are not repriced per dish.
  assert.throws(() => planCheckout({
    discountReason: "x",
    items: [{ orderItemId: "i3", quantity: 1, overridePriceCents: 1200 }],
    payments: [{ type: "cash", amount: 12 }]
  }, common), /set menu/);
});
