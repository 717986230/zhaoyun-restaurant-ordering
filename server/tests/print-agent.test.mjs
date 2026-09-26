import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "../database.mjs";
import { processPrintJob, renderReceipt } from "../print-agent.mjs";

function setup() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-print-agent-"));
  const database = createDatabase(path.join(directory, "restaurant.sqlite"));
  const product = database.listProducts(true).find((item) => item.sku === "R1");
  database.savePrinter({ name: "Kitchen", transport: "lan", address: "127.0.0.1", port: 9100, role: "kitchen", enabled: true, capabilities: { printLanguage: "en", encoding: "utf8" } });
  database.createOrder({ clientRequestId: `print-agent-${Date.now()}`, table: "08", note: "", items: [{ id: product.id, qty: 1 }] });
  return { database, directory };
}

test("print agent claims and completes a LAN job without duplicate processing", async () => {
  const { database, directory } = setup();
  try {
    let sent = 0;
    const result = await processPrintJob({ database, role: "kitchen", workerId: "worker-1", transport: { send: async (_printer, payload) => { sent += 1; assert.ok(payload.includes(Buffer.from("ZHAO YUN"))); } } });
    assert.equal(result.status, "printed");
    assert.equal(sent, 1);
    assert.equal(database.listPrintJobs("printed").length, 1);
    const second = await processPrintJob({ database, role: "kitchen", workerId: "worker-1", transport: { send: async () => { sent += 1; } } });
    assert.equal(second.processed, false);
    assert.equal(sent, 1);
    assert.ok(renderReceipt({ orderNo: "A", table: "08", items: [] }).includes(Buffer.from([0x1b, 0x40])));
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("print agent records a failed job for retry", async () => {
  const { database, directory } = setup();
  try {
    const result = await processPrintJob({ database, role: "kitchen", workerId: "worker-2", transport: { send: async () => { throw new Error("paper jam"); } } });
    assert.equal(result.status, "retry-wait");
    const jobs = database.listPrintJobs("retry-wait");
    assert.equal(jobs.length, 1);
    assert.match(jobs[0].error, /paper jam/);
    assert.equal(jobs[0].attempts, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("receipt selects the configured printer language and encoding", () => {
  const payload = {
    orderNo: "A",
    table: "08",
    items: [{ quantity: 1, name: "默认名称", names: { zh: "加面", de: "Extra Nudeln", en: "Extra noodles" }, modifiers: [] }]
  };
  const german = renderReceipt(payload, { capabilities: { printLanguage: "de", encoding: "utf8" } });
  assert.ok(german.includes(Buffer.from("Extra Nudeln", "utf8")));
  assert.equal(german.includes(Buffer.from("加面", "utf8")), false);
  const chinese = renderReceipt(payload, { capabilities: { printLanguage: "zh", encoding: "gb18030" } });
  assert.ok(chinese.includes(Buffer.from([0xBC, 0xD3, 0xC3, 0xE6])));
});

test("a kitchen ticket says it is no receipt and carries no price, even from an old payload", () => {
  // A payload queued before prices left kitchen tickets still has one.
  const payload = { orderNo: "A", table: "08", items: [{ quantity: 2, name: "Ramen", modifiers: [{ name: "Extra", names: { de: "Extra Nudeln" }, price: 2.5 }] }] };
  const ticket = renderReceipt(payload, { capabilities: { printLanguage: "de", encoding: "utf8" } }).toString("utf8");
  assert.match(ticket, /KÜCHENBON – KEIN BELEG/);
  assert.match(ticket, /Extra Nudeln/);
  assert.doesNotMatch(ticket, /2\.50/);
});

test("a bill line of a set menu split over two rates shows both", () => {
  const bill = {
    kind: "bill", table: "08", total: 12,
    items: [{ qty: 1, name: "Menü", lineTotal: 12, vatPercent: 10, vatSplit: [{ percent: 10, amount: 8 }, { percent: 20, amount: 4 }] }],
    vatBreakdown: [{ percent: 10, gross: 8, net: 7.27, vat: 0.73 }, { percent: 20, gross: 4, net: 3.33, vat: 0.67 }]
  };
  const printed = renderReceipt(bill, { capabilities: { printLanguage: "de", encoding: "utf8" } }).toString("utf8");
  assert.match(printed, /12\.00 {2}10%\/20%/);
  assert.match(printed, /Satz 20% {2}Netto 3\.33 {2}MwSt 0\.67/);
});

test("a receipt prints who issued it, its number, each rate and the change — and says it is unsigned", () => {
  const receipt = {
    kind: "receipt",
    company: { name: "Zhao Yun GmbH", address: "Mariahilfer Straße 1, 1060 Wien", uid: "ATU12345678" },
    receipt: {
      receiptNo: 12, cashRegisterId: "KASSE-1", type: "sale", table: "K1", createdAt: "2026-09-25T10:00:00.000Z", fiscalStatus: "unsigned",
      lines: [{ kind: "item", name: "Ramen", quantity: 2, unitPriceCents: 1000, totalCents: 2000, vatSplit: [{ percent: 10, cents: 2000 }], modifiers: [] }],
      vat: [{ percent: 10, grossCents: 2000, netCents: 1818, vatCents: 182 }],
      totalCents: 2000,
      payments: [{ type: "cash", amountCents: 2000, tenderedCents: 5000, changeCents: 3000 }]
    }
  };
  const printed = renderReceipt(receipt, { capabilities: { printLanguage: "de", encoding: "utf8" } }).toString("utf8");
  assert.match(printed, /^\u001b@TESTBELEG – NICHT SIGNIERT/);
  assert.match(printed, /Zhao Yun GmbH\nMariahilfer Straße 1, 1060 Wien\nUID: ATU12345678/);
  assert.match(printed, /Beleg 12 {2}Kasse KASSE-1/);
  assert.match(printed, /2 x Ramen {18}20\.00/);
  assert.match(printed, /10% Netto 18\.18 MwSt 1\.82 {2}20\.00/);
  assert.match(printed, /gegeben 50\.00 {2}Rückgeld 30\.00/);
  for (const line of printed.split("\n")) assert.ok(line.replace(/^\u001b@/, "").replace(/\u001dV\u0000$/, "").length <= 32, `too wide: ${line}`);

  const signed = renderReceipt({ ...receipt, receipt: { ...receipt.receipt, fiscalStatus: "signed" } }, { capabilities: { printLanguage: "de", encoding: "utf8" } }).toString("utf8");
  assert.doesNotMatch(signed, /NICHT SIGNIERT/);
});

test("the kitchen reads Chinese and the pickup number; the guest's receipt reads German", () => {
  const ticket = renderReceipt({ orderNo: "A1", table: "TA-7", pickupNo: 7, staffName: "Li", items: [{ quantity: 1, name: "蔬菜拉面", names: { zh: "蔬菜拉面", de: "Ramen mit Gemüse" }, modifiers: [] }] },
    { capabilities: { printLanguage: "zh", encoding: "utf8" } }).toString("utf8");
  assert.match(ticket, /外带 取餐号 7/);
  assert.match(ticket, /服务员: Li/);
  assert.match(ticket, /1 x 蔬菜拉面/);
  const receipt = renderReceipt({
    kind: "receipt", company: { name: "Zhao Yun GmbH" },
    receipt: {
      receiptNo: 3, cashRegisterId: "KASSE-1", type: "sale", table: "TA-7", staffName: "Li", createdAt: "2026-09-26T10:00:00.000Z", fiscalStatus: "unsigned",
      lines: [
        { kind: "item", name: "蔬菜拉面", names: { zh: "蔬菜拉面", de: "Ramen mit Gemüse", en: "Veggie ramen" }, quantity: 1, unitPriceCents: 1290, totalCents: 1290, vatSplit: [{ percent: 10, cents: 1290 }] },
        { kind: "discount", name: "Rabatt 10%", names: { zh: "折扣 10%", de: "Rabatt 10%", en: "Discount 10%" }, quantity: 1, unitPriceCents: -129, totalCents: -129, vatSplit: [{ percent: 10, cents: -129 }] }
      ],
      vat: [{ percent: 10, grossCents: 1161, netCents: 1055, vatCents: 106 }], totalCents: 1161, payments: [{ type: "cash", amountCents: 1161 }]
    }
  }, { capabilities: { printLanguage: "de", encoding: "utf8" } }).toString("utf8");
  assert.match(receipt, /1 x Ramen mit Gemüse {7}12\.90/);
  assert.match(receipt, /Rabatt 10% {17}-1\.29/);
  assert.match(receipt, /Kellner: Li/);
  assert.doesNotMatch(receipt, /蔬菜/);
});

test("a void ticket tells the kitchen to stop, with the quantity taken back and why", () => {
  const text = renderReceipt({ kind: "void", orderNo: "A-1", table: "08", reason: "Gast storniert", staffName: "Li", items: [{ name: "Ramen", names: { de: "Ramen", zh: "拉面" }, quantity: 2, modifiers: [] }] }, { capabilities: { printLanguage: "de" } }).toString("utf8");
  assert.match(text, /STORNO – NICHT ZUBEREITEN/);
  assert.match(text, /-2 x Ramen/);
  assert.match(text, /Grund: Gast storniert/);
  assert.doesNotMatch(text, /EUR|\d+\.\d{2}/, "no price on a kitchen ticket");
});

test("a receipt printed again says it is a copy; a settlement shows the voids", () => {
  const receipt = { receiptNo: 7, cashRegisterId: "KASSE-1", type: "sale", fiscalStatus: "unsigned", createdAt: "2026-09-26T10:00:00.000Z", lines: [], vat: [], totalCents: 0, payments: [] };
  assert.match(renderReceipt({ kind: "receipt", copy: true, company: {}, receipt }, { capabilities: { printLanguage: "de" } }).toString("utf8"), /BELEGKOPIE/);
  assert.doesNotMatch(renderReceipt({ kind: "receipt", company: {}, receipt }, { capabilities: { printLanguage: "de" } }).toString("utf8"), /BELEGKOPIE/);
  const totals = { firstReceiptNo: 1, lastReceiptNo: 2, sales: 2, stornos: 0, grossCents: 2500, payments: { cash: 2500, card: 0, voucher: 0 }, voids: { count: 1, cents: 950 } };
  const settlement = renderReceipt({ kind: "settlement", company: {}, settlement: { staffName: "Li", createdAt: "2026-09-26T22:00:00.000Z", totals } }, { capabilities: { printLanguage: "de" } }).toString("utf8");
  assert.match(settlement, /Stornos 1x\s+-9\.50/);
});
