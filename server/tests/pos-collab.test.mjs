import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../database.mjs";

/**
 * 多人同桌协同 (collaborative tables) and the fencing token on the table lock.
 *
 * The table lock is a pessimistic one device per table; a shared table lifts
 * that so several devices may order and void on it at once. What keeps their
 * writes from stepping on each other is not the lock but the journal's
 * optimistic one — every mutation claims the next journal sequence number, and
 * the loser of a race re-reads and re-plans — so opening the lock up is safe.
 * These tests hold that line: the default lock still refuses a second device,
 * a shared table lets both in, and two devices cannot void the same dish twice.
 */

function makeStore(context) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-collab-"));
  const databasePath = path.join(directory, "restaurant.sqlite");
  const store = createDatabase(databasePath);
  context.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, databasePath };
}

const deviceA = { deviceId: "dev-A", staff: { id: "s1", name: "Ann" } };
const deviceB = { deviceId: "dev-B", staff: { id: "s2", name: "Bea" } };

async function aProduct(store) {
  return (await store.listProducts(true)).find((product) => product.published && product.available);
}

test("the default table lock still refuses a second device", async (context) => {
  const { store } = makeStore(context);
  const product = await aProduct(store);
  await store.claimTable("05", deviceA);

  await assert.rejects(
    () => store.createOrder({ table: "05", items: [{ id: product.id, qty: 1 }] }, deviceB),
    (error) => error.code === "TABLE_CLAIMED",
    "a table locked to device A is closed to device B"
  );

  // Device A, the holder, orders freely.
  const order = await store.createOrder({ table: "05", items: [{ id: product.id, qty: 1 }] }, deviceA);
  assert.equal(order.table, "05");
});

test("a shared table lets several devices order and void at once", async (context) => {
  const { store } = makeStore(context);
  const product = await aProduct(store);

  const claim = await store.claimTable("05", deviceA, { shared: true });
  assert.equal(claim.shared, true, "the table is marked collaborative");
  // A second device joins without taking the table over: the lead name stays.
  const joined = await store.claimTable("05", deviceB, { shared: true });
  assert.equal(joined.shared, true);
  assert.equal(joined.deviceId, deviceA.deviceId, "joining does not seize the table");

  const orderA = await store.createOrder({ table: "05", items: [{ id: product.id, qty: 1 }] }, deviceA);
  const orderB = await store.createOrder({ table: "05", items: [{ id: product.id, qty: 1 }] }, deviceB);
  assert.notEqual(orderA.id, orderB.id, "both devices' orders land, append-only");

  const overview = (await store.tablesOverview()).find((table) => table.table === "05");
  assert.equal(overview.openOn?.shared, true, "the floor shows the table as collaborative");
  assert.equal(overview.orders.length, 2, "both orders are on the table");

  // Either device may void on the shared table. The order-item id comes from the
  // bill, the way the POS reads it before sending a void.
  const bill = await store.billForTable("05");
  const line = bill.items.find((item) => item.orderNo === orderA.no);
  const voided = await store.voidItem("05", { orderItemId: line.orderItemId, quantity: 1, reason: "test" }, deviceB, "manager");
  assert.equal(voided.quantity, 1, "device B voids device A's dish");
});

test("two devices cannot void the same dish twice (bounded decrement)", async (context) => {
  const { store } = makeStore(context);
  const product = await aProduct(store);
  await store.claimTable("05", deviceA, { shared: true });
  await store.claimTable("05", deviceB, { shared: true });
  await store.createOrder({ table: "05", items: [{ id: product.id, qty: 2 }] }, deviceA);
  const orderItemId = (await store.billForTable("05")).items[0].orderItemId;

  // Both devices try to void the whole line of 2 at the same moment.
  const results = await Promise.allSettled([
    store.voidItem("05", { orderItemId, quantity: 2, reason: "A" }, deviceA, "staff"),
    store.voidItem("05", { orderItemId, quantity: 2, reason: "B" }, deviceB, "staff")
  ]);
  const won = results.filter((result) => result.status === "fulfilled");
  const lost = results.filter((result) => result.status === "rejected");
  assert.equal(won.length, 1, "exactly one void of two succeeds");
  assert.equal(lost.length, 1, "the other is turned away, not over-voided");
  // The loser is turned away — either the line is already gone, or there is
  // nothing left of it to void. Both mean the dish was not voided a second time.
  assert.match(String(lost[0].reason?.message ?? lost[0].reason), /can be voided|not open on this table/);

  // The line shows exactly two voided — never four.
  const overview = (await store.tablesOverview()).find((table) => table.table === "05");
  assert.equal(overview.orders.length, 0, "the fully voided line leaves nothing open on the table");
});

test("the fencing token climbs when a lapsed table is taken over", async (context) => {
  const { store, databasePath } = makeStore(context);
  const first = await store.claimTable("05", deviceA);
  assert.equal(first.epoch, 1, "a fresh claim starts at epoch 1");

  // Renewing the same hold does not move the fence.
  const renewed = await store.claimTable("05", deviceA);
  assert.equal(renewed.epoch, 1, "the holder renewing keeps the epoch");

  // Age device A's hold out past its TTL, the way 90 seconds of silence would.
  const raw = new DatabaseSync(databasePath);
  raw.prepare("UPDATE table_claims SET expires_at = ? WHERE table_no = ?").run("2000-01-01T00:00:00.000Z", "05");
  raw.close();

  const taken = await store.claimTable("05", deviceB);
  assert.equal(taken.deviceId, deviceB.deviceId, "device B takes the lapsed table");
  assert.equal(taken.epoch, 2, "taking the table over bumps the fencing token");
});

test("并台: moving an open table onto an occupied one combines both bills", async (context) => {
  const { store } = makeStore(context);
  const product = await aProduct(store);

  // Two tables, both open on the same device (so the merge passes both locks),
  // each with its own order.
  await store.claimTable("11", deviceA);
  await store.createOrder({ table: "11", items: [{ id: product.id, qty: 2 }] }, deviceA);
  await store.claimTable("12", deviceA);
  await store.createOrder({ table: "12", items: [{ id: product.id, qty: 1 }] }, deviceA);

  // 并台: table 11 onto the occupied table 12.
  const moved = await store.moveTable("11", "12", deviceA);
  assert.equal(moved.to, "12");
  assert.equal(moved.moved, 1, "the one open order on table 11 is carried over");

  // Table 12 now carries both orders' portions (2 + 1); table 11 is empty.
  const billB = await store.billForTable("12");
  const qtyB = billB.items.reduce((sum, item) => sum + item.qty, 0);
  assert.equal(qtyB, 3, "both bills are combined on the target table");

  const billA = await store.billForTable("11");
  assert.equal(billA.items.length, 0, "the source table is left with nothing open");
});

test("催菜: urging a sent dish queues a kitchen reminder, the bill untouched", async (context) => {
  const { store } = makeStore(context);
  const product = await aProduct(store);
  await store.claimTable("14", deviceA);
  await store.createOrder({ table: "14", items: [{ id: product.id, qty: 2 }] }, deviceA);
  const bill = await store.billForTable("14");
  const itemId = bill.items[0].orderItemId;

  const urged = await store.urgeItem("14", itemId, deviceA);
  assert.equal(urged.orderItemId, itemId);

  const job = (await store.listPrintJobs("queued", 100)).find((entry) => entry.id === urged.printJobId);
  assert.ok(job, "a print job was queued for the urge");
  assert.equal(job.payload.kind, "urge");
  assert.equal(job.payload.table, "14");
  assert.equal(job.payload.items[0].quantity, 2);

  // 催菜 changes nothing on the bill: still two of the dish, nothing voided.
  const after = await store.billForTable("14");
  assert.equal(after.items.reduce((sum, item) => sum + item.qty, 0), 2);
});
