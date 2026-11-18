import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "../database.mjs";
import { assertOrderTransition } from "../../shared/orders.mjs";
import { planFire, planUrge } from "../../shared/register.mjs";
import { auditActor, auditView } from "../../shared/auth.mjs";

/**
 * The kitchen display (KDS): the order state machine it steps through, what
 * it shows for a held (等叫) dish and a rushed (催菜) one, and the personal
 * audit trail behind it. The board itself (apps/pos-web/src/Kitchen.tsx)
 * reads GET /api/orders and PATCHes the same transitions; these tests hold
 * the rules it relies on, at the store level, without a browser.
 */

function makeStore(context) {
  const directory = mkdtempSync(path.join(tmpdir(), "zy-kds-"));
  const store = createDatabase(path.join(directory, "restaurant.sqlite"));
  context.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}

const device = { deviceId: "dev-kds", staff: { id: "s1", name: "Ann" } };

async function aProduct(store) {
  return (await store.listProducts(true)).find((product) => product.published && product.available);
}

test("KDS status flow: new → preparing → ready → completed, and no skipping", async (context) => {
  const store = makeStore(context);
  const product = await aProduct(store);
  await store.claimTable("05", device);
  const order = await store.createOrder({ table: "05", items: [{ id: product.id, qty: 1 }] }, device);
  assert.equal(order.status, "new");

  // The board's own steps, one at a time.
  assert.equal((await store.updateOrder(order.id, "preparing")).status, "preparing");
  assert.equal((await store.updateOrder(order.id, "ready")).status, "ready");
  assert.equal((await store.updateOrder(order.id, "completed")).status, "completed");
  // A finished order is terminal.
  await assert.rejects(() => store.updateOrder(order.id, "preparing"), /Invalid order transition: completed -> preparing/);
});

test("KDS status flow: jumping ahead is refused, at the transition table", async (context) => {
  const store = makeStore(context);
  const product = await aProduct(store);
  await store.claimTable("06", device);
  const order = await store.createOrder({ table: "06", items: [{ id: product.id, qty: 1 }] }, device);
  await assert.rejects(() => store.updateOrder(order.id, "ready"), /Invalid order transition: new -> ready/);
  await assert.rejects(() => store.updateOrder(order.id, "completed"), /Invalid order transition: new -> completed/);
  // The pure rule agrees, without a database.
  assert.throws(() => assertOrderTransition("new", "ready"), /Invalid order transition: new -> ready/);
  assert.throws(() => assertOrderTransition("preparing", "completed"), /Invalid order transition: preparing -> completed/);
  assertOrderTransition("ready", "completed");
});

test("KDS held display: a 等叫 dish is held on the order until 叫起 fires it", async (context) => {
  const store = makeStore(context);
  const product = await aProduct(store);
  await store.claimTable("07", device);
  const order = await store.createOrder(
    { table: "07", items: [{ id: product.id, qty: 1, hold: true }, { id: product.id, qty: 1 }] },
    device
  );
  const listed = (await store.listOrders(10)).find((entry) => entry.id === order.id);
  // The board marks the held line 等叫 and cooks the other one.
  assert.equal(listed.items.filter((item) => item.held).length, 1);
  assert.equal(listed.items.filter((item) => !item.held).length, 1);
  // The bill agrees: the held line is on the bill, flagged — and the bill
  // carries the order-item id the fire call needs (the order view's item id
  // is the dish, not the line).
  const bill = await store.billForTable("07");
  const heldLine = bill.items.find((item) => item.held);
  const openLine = bill.items.find((item) => !item.held);
  assert.ok(heldLine);
  assert.equal(openLine.held, undefined);

  // 叫起: the held dish is fired to the kitchen, and the flag is gone.
  const firedResult = await store.fireItem("07", heldLine.orderItemId, device);
  assert.equal(firedResult.orderItemId, heldLine.orderItemId);
  const relisted = (await store.listOrders(10)).find((entry) => entry.id === order.id);
  assert.equal(relisted.items.every((item) => item.held === false), true);
  // Firing a dish that was never held is refused.
  await assert.rejects(() => store.fireItem("07", openLine.orderItemId, device), /not held/);
});

test("KDS held display, pure: planFire only fires a held dish, planUrge only rushes an open one", () => {
  const row = {
    id: "i1", order_id: "o1", order_no: "N1", table_no: "05", status: "new", billed_at: null,
    quantity: 2, paid_quantity: 0, voided_quantity: 0, product_name: "拉面",
    name_zh: "拉面", name_de: "Ramen", name_en: "Ramen", modifiers_json: "[]",
    print_station: "kitchen", held_at: "2026-11-18T10:00:00.000Z", item_note: "不要葱"
  };
  // 叫起 prints the held dish as an ordinary kitchen ticket, with its note.
  const fired = planFire(row, { table: "05", staff: device.staff });
  const payload = JSON.parse(fired.printJob.payloadJson);
  assert.equal(payload.kind, "order");
  assert.equal(payload.items[0].note, "不要葱");
  assert.equal(payload.staffName, "Ann");
  // Without the hold there is nothing to fire.
  assert.throws(() => planFire({ ...row, held_at: null }, { table: "05" }), /not held/);
  // 催菜 is a hurry ticket for a dish already sent: same dish, kind "urge".
  const urged = planUrge({ ...row, held_at: null }, { table: "05", staff: device.staff });
  assert.equal(JSON.parse(urged.printJob.payloadJson).kind, "urge");
  // A paid-up dish can be neither fired nor urged.
  assert.throws(() => planUrge({ ...row, held_at: null, paid_quantity: 2 }, { table: "05" }), /not open/);
  assert.throws(() => planFire({ ...row, paid_quantity: 2 }, { table: "05" }), /not held/);
});

test("audit trail: a waiter's PIN session is recorded by staff id, a shared token is not", async (context) => {
  // The helper the audit writer uses: a PIN session's staff gives both the
  // name (actor) and the id (staffId); a fixed-token login gives neither.
  assert.deepEqual(auditActor({ id: "s1", name: "Ann" }), { staffId: "s1", actor: "Ann" });
  assert.deepEqual(auditActor(null), {});
  assert.deepEqual(auditActor({ name: "Ann" }), { actor: "Ann" });

  // What the console reads back: staffId rides on the entry, next to the role.
  assert.equal(
    auditView({ id: "a1", at: "2026-11-18T10:00:00Z", role: "staff", ip: "", method: "POST", route: "/api/pos/orders", status: 201, detail_json: JSON.stringify({ actor: "Ann", staffId: "s1" }) }).staffId,
    "s1"
  );
  assert.equal(
    auditView({ id: "a2", at: "2026-11-18T10:00:00Z", role: "kitchen", ip: "", method: "GET", route: "/api/orders", status: 200, detail_json: "{}" }).staffId,
    null
  );

  // End to end through the store: the detail survives the write and the read.
  const store = makeStore(context);
  await store.recordAudit({ role: "staff", ip: "127.0.0.1", method: "POST", route: "/api/pos/orders", status: 201, detail: auditActor({ id: "s1", name: "Ann" }) });
  const [entry] = await store.listAudit(10);
  assert.equal(entry.staffId, "s1");
  assert.equal(entry.detail.actor, "Ann");
  assert.equal(entry.role, "staff");
});
