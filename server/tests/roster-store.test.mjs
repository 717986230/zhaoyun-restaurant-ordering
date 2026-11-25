import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "../database.mjs";

/**
 * 员工排班 through the store: a shift round-trips over SQLite, the date range
 * filters, a missing staff member is refused, and delete works. The pure engine
 * is covered in roster.test.mjs.
 */
function openDatabase(context) {
  const directory = mkdtempSync(path.join(tmpdir(), "zy-roster-"));
  const database = createDatabase(path.join(directory, "db.sqlite"));
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
  return database;
}

async function addStaff(db, name) {
  return (await db.saveStaff({ name, role: "staff", pin: "1234", active: true })).id;
}

test("a shift is created, listed by week, edited and deleted", async (t) => {
  const db = openDatabase(t);
  const anna = await addStaff(db, "Anna");

  const created = await db.saveShift({ staffId: anna, date: "2026-11-25", startMin: 540, endMin: 1020, note: "午市" });
  assert.ok(created.id);
  assert.equal(created.minutes, 480);
  assert.equal(created.overnight, false);

  // Outside the window → not listed; inside → listed.
  assert.equal((await db.listShifts("2026-11-26", "2026-11-30")).length, 0);
  const week = await db.listShifts("2026-11-23", "2026-11-29");
  assert.equal(week.length, 1);
  assert.equal(week[0].note, "午市");

  const edited = await db.saveShift({ id: created.id, staffId: anna, date: "2026-11-25", startMin: 1080, endMin: 120, note: "晚班" });
  assert.equal(edited.overnight, true);
  assert.equal(edited.minutes, 480);

  assert.equal(await db.deleteShift(created.id), true);
  assert.equal((await db.listShifts("2026-11-23", "2026-11-29")).length, 0);
});

test("a shift for a missing staff member is refused; a bad id update returns null", async (t) => {
  const db = openDatabase(t);
  await assert.rejects(db.saveShift({ staffId: "ghost", date: "2026-11-25", startMin: 540, endMin: 600 }), /staff member/);
  const anna = await addStaff(db, "Anna");
  assert.equal(await db.saveShift({ id: "nope", staffId: anna, date: "2026-11-25", startMin: 540, endMin: 600 }), null);
});

test("listShifts refuses a bad date range", async (t) => {
  const db = openDatabase(t);
  await assert.rejects(db.listShifts("nope", "2026-11-29"), /dates/);
});
