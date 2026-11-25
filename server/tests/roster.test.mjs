import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeShift, shiftMinutes, shiftView } from "../../shared/roster.mjs";

test("a shift is normalized and bounded", () => {
  const columns = normalizeShift({ staffId: "s1", date: "2026-11-25", startMin: 540, endMin: 1020, note: "  领班  " });
  assert.deepEqual(columns, { staff_id: "s1", work_date: "2026-11-25", start_min: 540, end_min: 1020, note: "领班" });
});

test("bad input is refused with a plain message", () => {
  assert.throws(() => normalizeShift({ date: "2026-11-25", startMin: 0, endMin: 60 }), /staff member/);
  assert.throws(() => normalizeShift({ staffId: "s1", date: "2026-13-01", startMin: 0, endMin: 60 }), /real date|needs a date/);
  assert.throws(() => normalizeShift({ staffId: "s1", date: "25/11/2026", startMin: 0, endMin: 60 }), /YYYY-MM-DD/);
  assert.throws(() => normalizeShift({ staffId: "s1", date: "2026-11-25", startMin: 0, endMin: 1500 }), /time of day/);
  assert.throws(() => normalizeShift({ staffId: "s1", date: "2026-11-25", startMin: 600, endMin: 600 }), /length/);
});

test("duration follows the midnight wrap", () => {
  assert.equal(shiftMinutes(540, 1020), 480); // 09:00–17:00 = 8h
  assert.equal(shiftMinutes(1080, 120), 480); // 18:00–02:00 = 8h overnight
  assert.equal(shiftMinutes(0, 1439), 1439);
});

test("the view marks an overnight shift and its length", () => {
  const same = shiftView({ id: "x", staff_id: "s1", work_date: "2026-11-25", start_min: 540, end_min: 1020, note: "" });
  assert.equal(same.minutes, 480);
  assert.equal(same.overnight, false);
  const night = shiftView({ id: "y", staff_id: "s1", work_date: "2026-11-25", start_min: 1080, end_min: 120, note: "" });
  assert.equal(night.overnight, true);
  assert.equal(night.minutes, 480);
});
