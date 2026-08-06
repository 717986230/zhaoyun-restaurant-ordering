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
