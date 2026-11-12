import assert from "node:assert/strict";
import test from "node:test";
import { availability, bookingView, normalizeReservationSettings, reservationContactMatches } from "../../shared/reservations.mjs";

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

test("the booking page offers the menu's languages, in its order", () => {
  assert.deepEqual(bookingView(rules, { timeZone: "Europe/Vienna", restaurantName: "X", languages: ["de", "zh"] }).languages, ["de", "zh"]);
  assert.equal(bookingView(rules, { timeZone: "Europe/Vienna", restaurantName: "X" }).languages, undefined);
});
