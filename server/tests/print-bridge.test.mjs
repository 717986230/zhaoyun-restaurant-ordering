import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import iconv from "iconv-lite";
import { buildServer } from "../index.mjs";
import { apiSource, bridgeSettings, createBridge, printersFor, run } from "../print-agent.mjs";
import { displayWidth, renderTickets, wrap } from "../tickets.mjs";

const ADMIN = "bridge-test-admin-token-bridge-test-admin";

/** A network printer on this machine: it keeps what it is sent. */
async function fakePrinter() {
  const received = [];
  const server = net.createServer((socket) => {
    const chunks = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => { if (chunks.length) received.push(Buffer.concat(chunks)); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, received, close: () => new Promise((resolve) => server.close(resolve)) };
}

const until = async (check, ms = 5_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
};

const text = (bytes) => bytes.toString("utf8").replace(/\u001b[@EadB][\s\S]?|\u001d[!V][\s\S]/g, "");

test("each station's ticket reaches its own printer, in that printer's language, the moment it is ordered", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zy-bridge-"));
  const app = await buildServer({ databasePath: path.join(directory, "db.sqlite"), uploadDir: path.join(directory, "media"), adminToken: ADMIN, logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const kitchen = await fakePrinter();
  const bar = await fakePrinter();
  const spare = await fakePrinter();
  let running;
  context.after(async () => {
    running?.stop();
    await app.close();
    await Promise.all([kitchen.close(), bar.close(), spare.close()]);
    rmSync(directory, { recursive: true, force: true });
  });
  const admin = async (method, url, body) => {
    const response = await fetch(`${base}${url}`, { method, headers: { "x-admin-token": ADMIN, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, json: await response.json().catch(() => ({})) };
  };
  const printer = async (name, role, port, capabilities) => (await admin("POST", "/api/admin/printers", { name, transport: "lan", address: "127.0.0.1", port, role, enabled: true, capabilities })).json.printer;

  const spareProfile = await printer("Spare", "front", spare.port, { printLanguage: "de" });
  await printer("Küche", "kitchen", kitchen.port, { printLanguage: "zh", encoding: "gb18030", largeText: true });
  const barProfile = await printer("Bar", "bar", bar.port, { printLanguage: "de", secondLanguage: "en", paperWidth: 80, backupPrinterId: spareProfile.id });
  const { token } = (await admin("POST", "/api/admin/pos-devices", { name: "Print bridge" })).json;
  assert.equal((await admin("PUT", "/api/admin/settings", { guestOrdering: { enabled: true, dineIn: true, requireOpenTable: false, minIntervalSeconds: 0 } })).status, 200);

  const bridge = createBridge({ source: apiSource({ baseUrl: base, token }), bridgeId: "bridge-test", name: "Test PC" });
  running = run(bridge, { live: `${base.replace("http", "ws")}/ws?role=staff`, pollMs: 60_000, livePollMs: 60_000, checkMs: 60_000 });
  // The live channel open, and the first check done.
  assert.ok(await until(async () => (await admin("GET", "/api/admin/printers")).json.bridges.length === 1), "the bridge checks in");

  const catalog = (await (await fetch(`${base}/api/catalog`)).json()).products;
  const ramen = catalog.find((product) => product.printStation === "kitchen" && !product.bundleItems?.length);
  const drink = catalog.find((product) => product.printStation === "bar" && product.names.de !== product.names.en);
  const ordered = await admin("POST", "/api/orders", { clientRequestId: "bridge-order-1", table: "12", note: "", items: [{ id: ramen.id, qty: 2 }, { id: drink.id, qty: 1 }] });
  assert.equal(ordered.status, 201, JSON.stringify(ordered.json));

  assert.ok(await until(() => kitchen.received.length === 1 && bar.received.length === 1), "both stations print, woken by the order");
  const kitchenTicket = iconv.decode(kitchen.received[0], "gb18030");
  assert.match(kitchenTicket, new RegExp(`2 x ${ramen.names.zh}`), "the kitchen reads Chinese");
  assert.match(kitchenTicket, /桌号 12/);
  assert.ok(kitchen.received[0].includes(Buffer.from([0x1d, 0x21, 0x01])), "large type for the dishes");
  assert.doesNotMatch(kitchenTicket, new RegExp(drink.names.zh), "the drink is the bar's");
  const barTicket = text(bar.received[0]);
  assert.match(barTicket, new RegExp(`1 x ${drink.names.de}`), "the bar reads German");
  assert.match(barTicket, new RegExp(`\\(${drink.names.en.replace(/[()]/g, ".")}\\)`), "and English under it");
  assert.match(barTicket, /-{48}/, "on 80 mm paper");

  // A test page for one printer, from the console, prints on that printer at once.
  assert.equal((await admin("POST", `/api/admin/printers/${barProfile.id}/test`)).status, 201);
  assert.ok(await until(() => bar.received.length === 2), "the test page arrives");
  assert.match(text(bar.received[1]), /TESTDRUCK/);

  // The bar printer is gone: its ticket goes to the backup, marked as standing in.
  await bar.close();
  await admin("POST", "/api/orders", { clientRequestId: "bridge-order-2", table: "12", note: "", items: [{ id: drink.id, qty: 3 }] });
  assert.ok(await until(() => spare.received.length === 1, 10_000), "the backup prints");
  assert.match(text(spare.received[0]), /ERSATZ FÜR Bar/);
  assert.match(text(spare.received[0]), new RegExp(`3 x ${drink.names.de}`));

  // And the console knows which printer is not answering.
  assert.ok(await until(async () => {
    const printers = (await admin("GET", "/api/admin/printers")).json.printers;
    return printers.find((entry) => entry.id === barProfile.id)?.status?.online === false;
  }), "the console shows the bar printer offline");
  const printed = (await admin("GET", "/api/admin/print-jobs?status=printed&limit=50")).json.jobs;
  assert.equal(printed.length, 4, "every job printed once");
});

test("a station's printers in order, then the backup the first one names; a test page only to its printer", () => {
  const printers = [
    { id: "k1", name: "K1", role: "kitchen", transport: "lan", enabled: true, capabilities: { backupPrinterId: "f1" } },
    { id: "k2", name: "K2", role: "kitchen", transport: "lan", enabled: true, capabilities: {} },
    { id: "k3", name: "K3", role: "kitchen", transport: "bluetooth", enabled: true, capabilities: {} },
    { id: "k4", name: "K4", role: "kitchen", transport: "lan", enabled: false, capabilities: {} },
    { id: "f1", name: "F1", role: "front", transport: "lan", enabled: true, capabilities: {} }
  ];
  assert.deepEqual(printersFor({ printerRole: "kitchen", payload: {} }, printers).map((printer) => printer.id), ["k1", "k2", "f1"]);
  assert.deepEqual(printersFor({ printerRole: "bar", payload: {} }, printers), []);
  assert.deepEqual(printersFor({ printerRole: "kitchen", payload: { kind: "test", printerId: "k2" } }, printers).map((printer) => printer.id), ["k2"]);
  assert.deepEqual(printersFor({ printerRole: "kitchen", payload: { kind: "test", printerId: "k3" } }, printers), [], "not a network printer");
});

test("a failed delivery is reported with every printer tried, and the console hears which ones answer", async () => {
  const calls = [];
  const source = {
    printers: async () => [{ id: "k1", name: "K1", role: "kitchen", transport: "lan", enabled: true, capabilities: {} }],
    claim: async () => (calls.includes("claimed") ? [] : (calls.push("claimed"), [{ id: "j1", printerRole: "kitchen", payload: { orderNo: "A", table: "1", items: [] } }])),
    complete: async () => calls.push("complete"),
    fail: async (id, worker, error) => calls.push(`fail ${id} ${error}`),
    report: async (report) => calls.push(report)
  };
  const bridge = createBridge({ source, bridgeId: "b1", transport: { send: async () => { throw new Error("paper out"); }, probe: async () => {} } });
  const [result] = await bridge.drain();
  assert.equal(result.status, "not-printed");
  assert.ok(calls.includes("fail j1 K1: paper out"));
  assert.equal(bridge.statusChanged, true);
  await bridge.check();
  const report = calls.at(-1);
  assert.deepEqual(report, { bridgeId: "b1", name: "b1", version: "2", printers: [{ id: "k1", ok: true }] });
});

const plain = (bytes, encoding = "utf8") => iconv.decode(bytes, encoding).replace(/\u001b[@EadB][\s\S]?|\u001d[!V][\s\S]/g, "");
const order = {
  orderNo: "A1", table: "08", staffName: "Li",
  items: [
    { quantity: 2, name: "蔬菜拉面", names: { zh: "蔬菜拉面", de: "Gemüse-Ramen", en: "Veggie ramen" }, modifiers: [{ name: "加面", names: { zh: "加面", de: "Extra Nudeln" } }] },
    { quantity: 1, name: "春卷", names: { zh: "春卷", de: "Frühlingsrolle", en: "Spring roll" }, modifiers: [] }
  ]
};

test("Chinese is two columns wide, and a long line wraps under itself", () => {
  assert.equal(displayWidth("拉面 ab"), 7);
  assert.deepEqual(wrap("Gebratene Nudeln mit Gemüse und Ei", 16, "  "), ["Gebratene Nudeln", "  mit Gemüse und", "  Ei"]);
  assert.deepEqual(wrap("宫保鸡丁宫保鸡丁宫保鸡丁宫保鸡丁宫保鸡丁", 32), ["宫保鸡丁宫保鸡丁宫保鸡丁宫保鸡丁", "宫保鸡丁"]);
  const receipt = {
    kind: "receipt", company: {},
    receipt: {
      receiptNo: 1, cashRegisterId: "K1", type: "sale", fiscalStatus: "signed", createdAt: "2026-09-27T10:00:00.000Z",
      lines: [{ kind: "item", name: "蔬菜拉面", names: { zh: "蔬菜拉面" }, quantity: 1, unitPriceCents: 1290, totalCents: 1290, vatSplit: [{ percent: 10, cents: 1290 }] }],
      vat: [], totalCents: 1290, payments: []
    }
  };
  const printed = plain(renderTickets(receipt, { capabilities: { printLanguage: "zh", paperWidth: 80 } }));
  const line = printed.split("\n").find((entry) => entry.includes("蔬菜拉面"));
  assert.equal(displayWidth(line), 48, "the amount keeps its column behind Chinese");
  assert.ok(line.endsWith("12.90"));
});

test("a second language under each dish; one ticket per dish; copies", () => {
  const both = plain(renderTickets(order, { capabilities: { printLanguage: "zh", secondLanguage: "de" } }, { station: "kitchen" }));
  assert.match(both, /2 x 蔬菜拉面\n {4}\(Gemüse-Ramen\)\n {2}- 加面 \/ Extra Nudeln/);
  assert.match(both, /\n厨房\n/, "the station, on its own line");
  const cuts = (bytes) => bytes.toString("latin1").split("\u001dV\u0000").length - 1;
  assert.equal(cuts(renderTickets(order, { capabilities: {} })), 1);
  const split = renderTickets(order, { capabilities: { printLanguage: "de", splitItems: true, copies: 2 } });
  assert.equal(cuts(split), 4, "two dishes, each on its own ticket, twice");
  assert.match(plain(split), /Bon 1\/2[\s\S]*Gemüse-Ramen[\s\S]*Bon 2\/2[\s\S]*Frühlingsrolle/);
  assert.equal(cuts(renderTickets({ kind: "receipt", company: {}, receipt: { receiptNo: 1, cashRegisterId: "K", type: "sale", fiscalStatus: "signed", lines: [], vat: [], totalCents: 0, payments: [] } }, { capabilities: { copies: 3 } })), 1, "copies are for the kitchen's tickets, not receipts");
});

test("what an encoding cannot show: umlauts spelled out for a Chinese printer, English for a printer without Chinese", () => {
  const chinese = plain(renderTickets(order, { capabilities: { printLanguage: "zh", secondLanguage: "de", encoding: "gb18030" } }), "gb18030");
  assert.match(chinese, /\(Gemuese-Ramen\)/);
  assert.match(chinese, /蔬菜拉面/);
  const latin = plain(renderTickets(order, { capabilities: { printLanguage: "zh", encoding: "cp437" } }), "cp437");
  assert.match(latin, /2 x Veggie ramen/);
  assert.doesNotMatch(latin, /\?\?/);
});

test("a beep and large type when the printer is set so; a test page shows the paper's width", () => {
  const loud = renderTickets(order, { capabilities: { beep: true, largeText: true } });
  assert.ok(loud.subarray(0, 6).equals(Buffer.from([0x1b, 0x40, 0x1b, 0x42, 0x03, 0x02])));
  assert.ok(loud.includes(Buffer.from([0x1d, 0x21, 0x01])));
  assert.equal(renderTickets(order, { capabilities: {} }).includes(Buffer.from([0x1b, 0x42])), false);
  const page = plain(renderTickets({ kind: "test", printerName: "Bar", station: "bar", at: "2026-09-27T10:00:00.000Z" }, { capabilities: { printLanguage: "en", paperWidth: 80 } }));
  assert.match(page, /TEST PRINT/);
  assert.match(page, /123456789012345678901234567890123456789012345678\n/);
  assert.match(page, /Station: BAR/);
});

test("the bridge keeps the address and token it was first started with", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zy-bridge-config-"));
  const file = path.join(directory, "print-bridge.config.json");
  try {
    assert.deepEqual(bridgeSettings([], {}, file), { url: "", token: "", staffToken: "" }, "nothing yet: the local database");
    assert.equal(bridgeSettings(["--url=https://example.test", "--token=abc=="], {}, file).token, "abc==", "a token may end in =");
    assert.deepEqual(bridgeSettings([], {}, file), { url: "https://example.test", token: "abc==", staffToken: "" }, "remembered");
    assert.equal(bridgeSettings([], { PRINT_BRIDGE_URL: "https://other.test" }, file).url, "https://other.test", "the environment wins over the file");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
