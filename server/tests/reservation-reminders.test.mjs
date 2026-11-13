import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../database.mjs";
import { remindReservations } from "../../shared/reminders.mjs";
import { reminderMessage } from "../../shared/mail.mjs";
import { addDays, localNow } from "../../shared/reservations.mjs";

/**
 * The day-before reminder: tomorrow's confirmed bookings with an address get
 * one email each, once. These check the store's query and the runner's logic
 * (shared/reservation-store.mjs, shared/reminders.mjs).
 */

const COLUMNS = "id, reference, token_hash, date, time, party, name, phone, email, notes, language, status, table_no, source, customer_id, created_at, updated_at";

function insertReservation(db, row) {
  const full = { token_hash: null, phone: "", email: "", notes: "", language: "", table_no: null, source: "guest", customer_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...row };
  db.prepare(`INSERT INTO reservations (${COLUMNS}) VALUES (${COLUMNS.split(", ").map(() => "?").join(", ")})`)
    .run(full.id, full.reference, full.token_hash, full.date, full.time, full.party, full.name, full.phone, full.email, full.notes, full.language, full.status, full.table_no, full.source, full.customer_id, full.created_at, full.updated_at);
}

function withDatabase(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zy-remind-"));
  const file = path.join(directory, "restaurant.sqlite");
  const store = createDatabase(file);
  return Promise.resolve(run(store, file)).finally(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
}

test("remindableFor returns tomorrow's confirmed bookings with an address, once", async () => {
  await withDatabase(async (store, file) => {
    const db = new DatabaseSync(file);
    // The guest typed an email.
    insertReservation(db, { id: "r1", reference: "AAAAA1", date: "2026-03-10", time: "19:00", party: 2, name: "Anna", email: "anna@example.com", status: "confirmed" });
    // No email on the booking, but their account has one.
    db.prepare("INSERT INTO customers (id, email, name, password_hash, password_salt, password_iterations, points, created_at, updated_at) VALUES ('c1', 'ben@example.com', 'Ben', 'x', 'x', 1, 0, 'x', 'x')").run();
    insertReservation(db, { id: "r2", reference: "AAAAA2", date: "2026-03-10", time: "20:00", party: 4, name: "Ben", email: "", customer_id: "c1", status: "confirmed" });
    // No way to reach this one — skipped.
    insertReservation(db, { id: "r3", reference: "AAAAA3", date: "2026-03-10", time: "18:00", party: 2, name: "No Mail", email: "", status: "confirmed" });
    // Still pending, not yet confirmed — not reminded.
    insertReservation(db, { id: "r4", reference: "AAAAA4", date: "2026-03-10", time: "21:00", party: 2, name: "Pending", email: "p@example.com", status: "pending" });
    // A different day.
    insertReservation(db, { id: "r5", reference: "AAAAA5", date: "2026-03-11", time: "19:00", party: 2, name: "Later", email: "l@example.com", status: "confirmed" });
    db.close();

    const due = await store.reservations.remindableFor("2026-03-10");
    assert.deepEqual(due.map((r) => r.id).sort(), ["r1", "r2"]);
    assert.equal(due.find((r) => r.id === "r2").email, "ben@example.com", "falls back to the account's email");

    // Once marked, it is not due again.
    await store.reservations.markReminded("r1");
    const after = await store.reservations.remindableFor("2026-03-10");
    assert.deepEqual(after.map((r) => r.id), ["r2"]);
    // Marking twice is harmless.
    await store.reservations.markReminded("r1");
  });
});

test("the runner emails tomorrow's bookings through the outbox and marks each once", async () => {
  await withDatabase(async (store, file) => {
    const db = new DatabaseSync(file);
    // Reservations must be on for the runner to do anything.
    const settings = await store.getSettings();
    await store.saveSettings({ reservations: { ...settings.reservations, enabled: true } });
    const tomorrow = addDays(localNow(settings.timeZone).date, 1);
    insertReservation(db, { id: "t1", reference: "BBBBB1", date: tomorrow, time: "19:00", party: 2, name: "Clara", email: "clara@example.com", language: "de", status: "confirmed" });
    db.close();

    const first = await remindReservations({ store, mail: { provider: "outbox" } });
    assert.equal(first.ran, true);
    assert.equal(first.sent, 1);
    const outbox = await store.customers.outbox();
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, "clara@example.com");
    assert.match(outbox[0].subject, /morgen|tomorrow|明天/);

    // A second run the same day sends nothing more.
    const second = await remindReservations({ store, mail: { provider: "outbox" } });
    assert.equal(second.sent, 0);
    assert.equal((await store.customers.outbox()).length, 1);
  });
});

test("the runner does nothing when reservations are off", async () => {
  await withDatabase(async (store) => {
    const result = await remindReservations({ store, mail: { provider: "outbox" } });
    assert.equal(result.ran, false);
    assert.equal(result.sent, 0);
  });
});

test("the runner does nothing when mail is off", async () => {
  await withDatabase(async (store) => {
    const result = await remindReservations({ store, mail: null });
    assert.equal(result.ran, false);
  });
});

test("a failed send leaves the booking unmarked, to try again tomorrow", async () => {
  await withDatabase(async (store, file) => {
    const db = new DatabaseSync(file);
    const settings = await store.getSettings();
    await store.saveSettings({ reservations: { ...settings.reservations, enabled: true } });
    const tomorrow = addDays(localNow(settings.timeZone).date, 1);
    insertReservation(db, { id: "f1", reference: "CCCCC1", date: tomorrow, time: "19:00", party: 2, name: "Dora", email: "dora@example.com", status: "confirmed" });
    db.close();

    // A Brevo config whose send always fails: nothing is marked.
    const mail = { provider: "brevo", apiKey: "k", senderEmail: "from@example.com", senderName: "" };
    const result = await remindReservations({ store, mail, send: async () => ({ ok: false, text: async () => "nope" }) });
    assert.equal(result.sent, 0);
    assert.equal(result.due, 1);
    const stillDue = await store.reservations.remindableFor(tomorrow);
    assert.deepEqual(stillDue.map((r) => r.id), ["f1"]);
  });
});

test("reminderMessage carries the booking and the right language", () => {
  const message = reminderMessage({ date: "2026-03-10", time: "19:00", party: 2, table: "12", reference: "ABCDEF" }, { language: "zh", restaurant: "赵云" });
  assert.match(message.subject, /明天/);
  assert.match(message.text, /ABCDEF/);
  assert.match(message.text, /19:00/);
  assert.match(message.text, /12/);
});
