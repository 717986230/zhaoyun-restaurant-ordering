import assert from "node:assert/strict";
import test from "node:test";
import { isOnSchedule, normalizeSchedule, readSchedule, normalizeTimeZone, wallClock } from "../../src/schedule.js";

const VIENNA = "Europe/Vienna";
// Wednesday 2026-09-23 in Vienna (UTC+2 in summer).
const at = (iso) => new Date(iso);

test("a lunch set is on during lunch on a weekday, and nowhere else", () => {
  const lunch = normalizeSchedule({ days: [1, 2, 3, 4, 5], from: "11:00", to: "14:30" });
  assert.equal(isOnSchedule(lunch, at("2026-09-23T09:00:00Z"), VIENNA), true, "11:00 Wednesday");
  assert.equal(isOnSchedule(lunch, at("2026-09-23T12:29:00Z"), VIENNA), true, "14:29");
  assert.equal(isOnSchedule(lunch, at("2026-09-23T12:30:00Z"), VIENNA), false, "14:30 is when it goes");
  assert.equal(isOnSchedule(lunch, at("2026-09-23T08:59:00Z"), VIENNA), false, "10:59");
  assert.equal(isOnSchedule(lunch, at("2026-09-26T10:00:00Z"), VIENNA), false, "Saturday noon");
});

test("the restaurant's clock decides, not the phone's", () => {
  const lunch = normalizeSchedule({ days: [1, 2, 3, 4, 5, 6, 7], from: "11:00", to: "14:30" });
  const noonInVienna = at("2026-09-23T10:00:00Z");
  assert.equal(isOnSchedule(lunch, noonInVienna, VIENNA), true);
  assert.equal(isOnSchedule(lunch, noonInVienna, "Asia/Shanghai"), false, "18:00 in Shanghai");
  // Winter time: noon in Vienna is 11:00 UTC.
  assert.equal(isOnSchedule(lunch, at("2026-01-14T13:40:00Z"), VIENNA), false, "14:40 in January");
  assert.equal(isOnSchedule(lunch, at("2026-01-14T13:20:00Z"), VIENNA), true, "14:20 in January");
});

test("a late-night menu runs past midnight and belongs to the evening it started", () => {
  const late = normalizeSchedule({ days: [5, 6], from: "22:00", to: "02:00" });
  assert.equal(isOnSchedule(late, at("2026-09-25T20:30:00Z"), VIENNA), true, "Friday 22:30");
  assert.equal(isOnSchedule(late, at("2026-09-25T23:30:00Z"), VIENNA), true, "Saturday 01:30, Friday's night");
  assert.equal(isOnSchedule(late, at("2026-09-27T23:30:00Z"), VIENNA), false, "Monday 01:30, after a Sunday");
  assert.equal(isOnSchedule(late, at("2026-09-27T20:30:00Z"), VIENNA), false, "Sunday 22:30");
  assert.equal(isOnSchedule(late, at("2026-09-27T00:30:00Z"), VIENNA), false, "Sunday 02:30, it has gone");
  assert.equal(isOnSchedule(late, at("2026-09-26T23:30:00Z"), VIENNA), true, "Sunday 01:30, Saturday's night");
});

test("equal times mean all day, on the days given", () => {
  const weekend = normalizeSchedule({ days: [6, 7], from: "00:00", to: "00:00" });
  assert.equal(isOnSchedule(weekend, at("2026-09-26T22:30:00Z"), VIENNA), true, "Sunday 00:30");
  assert.equal(isOnSchedule(weekend, at("2026-09-25T21:59:00Z"), VIENNA), false, "Friday 23:59");
});

test("no schedule is always on", () => {
  assert.equal(isOnSchedule(null, at("2026-09-23T03:00:00Z"), VIENNA), true);
  assert.equal(normalizeSchedule(null), null);
  assert.equal(normalizeSchedule(undefined), null);
});

test("a schedule is checked on the way in, and read back leniently", () => {
  assert.deepEqual(normalizeSchedule({ days: [3, 1, 3], from: "09:05", to: "17:00" }), { days: [1, 3], from: "09:05", to: "17:00" });
  for (const bad of [{ days: [], from: "11:00", to: "12:00" }, { days: [8], from: "11:00", to: "12:00" }, { days: [1], from: "24:00", to: "12:00" }, { days: [1], from: "9:00", to: "12:00" }, { from: "11:00", to: "12:00" }, [1], "lunch"]) {
    assert.throws(() => normalizeSchedule(bad), undefined, JSON.stringify(bad));
  }
  assert.equal(readSchedule("not json"), null);
  assert.equal(readSchedule(JSON.stringify({ days: [], from: "11:00", to: "12:00" })), null);
  assert.deepEqual(readSchedule(JSON.stringify({ days: [1], from: "11:00", to: "12:00" })), { days: [1], from: "11:00", to: "12:00" });
});

test("time zones are checked, and an unknown one falls back to the device clock", () => {
  assert.equal(normalizeTimeZone(" Europe/Vienna "), "Europe/Vienna");
  assert.throws(() => normalizeTimeZone("Mars/Olympus"));
  assert.throws(() => normalizeTimeZone(""));
  const date = at("2026-09-23T10:00:00Z");
  assert.deepEqual(wallClock(date, "Mars/Olympus"), { day: date.getDay() || 7, minute: date.getHours() * 60 + date.getMinutes() });
  assert.deepEqual(wallClock(at("2026-09-27T22:00:00Z"), VIENNA), { day: 1, minute: 0 }, "midnight is minute 0 of Monday");
});
