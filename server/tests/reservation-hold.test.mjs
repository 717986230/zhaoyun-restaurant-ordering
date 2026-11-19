import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "../database.mjs";
import { localNow } from "../../shared/reservations.mjs";

/**
 * The reservation table hold, over a real SQLite store: a booking with a table
 * holds it now (its time is "now", always inside the window), a guest checks in
 * only their own booking, and once seated the hold is gone.
 */
test("a booking holds its table, and only its own guest checks in, which lifts the hold", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-hold-"));
  const store = createDatabase(path.join(directory, "restaurant.sqlite"));
  context.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await store.saveSettings({
    reservations: {
      enabled: true,
      hours: [{ days: [1, 2, 3, 4, 5, 6, 7], from: "00:00", to: "23:30" }],
      intervalMinutes: 30,
      tables: [{ table: "7", seats: 4 }],
      holdBeforeMinutes: 30,
      releaseAfterMinutes: 10,
      noShowAfterMinutes: 180
    }
  });

  const { timeZone } = await store.getSettings();
  const clock = localNow(timeZone);
  // The booking's time is the restaurant's "now": always inside [now-30, now+10].
  const time = `${String(Math.floor(clock.minute / 60)).padStart(2, "0")}:${String(clock.minute % 60).padStart(2, "0")}`;

  const guest = await store.customers.register({ email: `guest-${Date.now().toString(36)}@example.com`, password: "secret123", name: "Guest" });
  const other = await store.customers.register({ email: `other-${Date.now().toString(36)}@example.com`, password: "secret123", name: "Other" });

  const { reservation: created } = await store.reservations.create(
    { date: clock.date, time, party: 2, name: "Guest", phone: "+43 660 1234567", table: "7" },
    { staff: true, customer: { id: guest.customer.id } }
  );
  assert.equal(created.status, "confirmed");
  assert.equal(created.table, "7");

  // The floor sees table 7 held by this booking.
  const held = await store.reservations.heldTables();
  assert.deepEqual(held.map((entry) => entry.table), ["7"]);
  const hold = await store.reservations.holdOn("7");
  assert.equal(hold?.reference, created.reference);
  assert.equal(await store.reservations.holdOn("8"), null, "a table nobody booked is not held");

  // Another guest scanning the table cannot check in against this booking.
  assert.equal(await store.reservations.checkIn("7", { customerId: other.customer.id }), null);
  assert.equal((await store.reservations.holdOn("7"))?.reference, created.reference, "still held, nobody checked in");

  // The booked guest scanning the table checks themselves in: seated, hold gone.
  const seated = await store.reservations.checkIn("7", { customerId: guest.customer.id });
  assert.equal(seated?.status, "seated");
  assert.equal(await store.reservations.holdOn("7"), null, "a seated booking no longer holds the table");
  assert.deepEqual(await store.reservations.heldTables(), []);
});
