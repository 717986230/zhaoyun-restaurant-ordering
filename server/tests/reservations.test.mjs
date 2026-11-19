import assert from "node:assert/strict";
import test from "node:test";
import { availability, bookingView, holdsTableNow, normalizeReservationSettings, reservationContactMatches } from "../../shared/reservations.mjs";

const rules = normalizeReservationSettings({ enabled: true, hours: [{ days: [1, 2, 3, 4, 5, 6, 7], from: "11:00", to: "14:00" }], intervalMinutes: 30, leadMinutes: 60, capacity: 10 });

test("a time already past, or too soon to book, is not offered: only a time with no room is 'full'", () => {
  // 12:57 on the day: 11:00 to 13:30 are gone or too soon (an hour's notice), 14:00 is the first left.
  const slots = availability(rules, "2026-10-07", 2, [], { date: "2026-10-07", minute: 12 * 60 + 57 });
  assert.deepEqual(slots.map((slot) => slot.time), ["14:00"]);
  assert.equal(slots[0].available, true);
  // Another day: every time, and one with no room says so.
  const full = availability(rules, "2026-10-08", 2, [{ minute: 12 * 60, party: 10, table: "" }], { date: "2026-10-07", minute: 12 * 60 + 57 });
  assert.equal(full.length, 7);
  assert.equal(full.find((slot) => slot.time === "12:00").available, false);
  assert.equal(full.find((slot) => slot.time === "14:00").available, true, "free again once the ten have left");
});

test("a booking is found again by the phone or email it was made with, however written", () => {
  const row = { phone: "+43 660 9090909", email: "Anna@Example.com" };
  // The same mobile number written any of the ways a guest might type it.
  assert.equal(reservationContactMatches(row, "0043 660 9090909"), true);
  assert.equal(reservationContactMatches(row, "0660 9090909"), true);
  assert.equal(reservationContactMatches(row, "+43 660 9090909"), true);
  // The email, in any case.
  assert.equal(reservationContactMatches(row, "anna@example.com"), true);
  // Another number, another email, or nothing at all: no match.
  assert.equal(reservationContactMatches(row, "0660 0000000"), false);
  assert.equal(reservationContactMatches(row, "ben@example.com"), false);
  assert.equal(reservationContactMatches(row, ""), false);
  assert.equal(reservationContactMatches(row, "  "), false);
  // A booking missing the field the guest gives never matches on it.
  assert.equal(reservationContactMatches({ phone: "", email: "" }, "0660 9090909"), false);
  assert.equal(reservationContactMatches({ phone: "+43 660 9090909", email: "" }, "a@b.com"), false);
});

test("a booking holds its table from holdBeforeMinutes before its time until releaseAfterMinutes past it", () => {
  const held = normalizeReservationSettings({ enabled: true, hours: [{ days: [1, 2, 3, 4, 5, 6, 7], from: "11:00", to: "22:00" }], intervalMinutes: 30, holdBeforeMinutes: 30, releaseAfterMinutes: 10 });
  const booking = { date: "2026-11-18", time: "19:00", table_no: "7", status: "confirmed" };
  const at = (minute) => ({ date: "2026-11-18", minute });
  // 19:00 = 1140. The window is [18:30, 19:10].
  assert.equal(holdsTableNow(booking, held, at(18 * 60 + 29)), false, "a minute before the hold opens: free");
  assert.equal(holdsTableNow(booking, held, at(18 * 60 + 30)), true, "the hold opens 30 minutes before");
  assert.equal(holdsTableNow(booking, held, at(19 * 60)), true, "at the booking's time");
  assert.equal(holdsTableNow(booking, held, at(19 * 60 + 10)), true, "the grace is still on at +10");
  assert.equal(holdsTableNow(booking, held, at(19 * 60 + 11)), false, "the table is freed past the grace");
  // Only a booking still waiting for its guest holds a table.
  assert.equal(holdsTableNow({ ...booking, status: "seated" }, held, at(19 * 60)), false, "a seated booking is an occupancy, not a hold");
  assert.equal(holdsTableNow({ ...booking, status: "cancelled" }, held, at(19 * 60)), false, "a cancelled booking holds nothing");
  assert.equal(holdsTableNow({ ...booking, table_no: "" }, held, at(19 * 60)), false, "no table assigned, nothing to hold");
  assert.equal(holdsTableNow(booking, held, { date: "2026-11-19", minute: 19 * 60 }), false, "another day does not hold today's table");
});

test("the booking page offers the menu's languages, in its order", () => {
  assert.deepEqual(bookingView(rules, { timeZone: "Europe/Vienna", restaurantName: "X", languages: ["de", "zh"] }).languages, ["de", "zh"]);
  assert.equal(bookingView(rules, { timeZone: "Europe/Vienna", restaurantName: "X" }).languages, undefined);
});
