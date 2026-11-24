import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "../database.mjs";

/**
 * 营销活动 CRUD through the store (store.listPromotions / savePromotion /
 * deletePromotion). The pure engine is covered in promotions.test.mjs; this
 * checks the rows round-trip through SQLite and the validation refuses.
 */
function openDatabase(context) {
  const directory = mkdtempSync(path.join(tmpdir(), "zy-promos-"));
  const database = createDatabase(path.join(directory, "db.sqlite"));
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
  return database;
}

test("a promotion is created, read back, edited and deleted", async (t) => {
  const db = openDatabase(t);
  assert.deepEqual(await db.listPromotions(), []);

  const created = await db.savePromotion({
    name: { zh: "满惠週", de: "Happy", en: "Happy" }, kind: "percent", percent: 10,
    weekdays: [5], startMin: 660, endMin: 840, activeFrom: "2026-11-24", enabled: true, priority: 2
  });
  assert.ok(created.id);
  assert.equal(created.percent, 10);
  assert.deepEqual(created.weekdays, [5]);
  assert.equal(created.enabled, true);

  const listed = await db.listPromotions();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name.zh, "满惠週");

  const edited = await db.savePromotion({ id: created.id, name: created.name, kind: "percent", percent: 20, enabled: false });
  assert.equal(edited.percent, 20);
  assert.equal(edited.enabled, false);
  assert.equal(edited.weekdays.length, 0); // the edit replaced the row

  assert.equal(await db.savePromotion({ id: "nope", name: { zh: "x", de: "", en: "" }, percent: 5 }), null);
  assert.equal(await db.deletePromotion(created.id), true);
  assert.equal(await db.deletePromotion(created.id), false);
  assert.deepEqual(await db.listPromotions(), []);
});

test("the store refuses an invalid promotion", async (t) => {
  const db = openDatabase(t);
  await assert.rejects(() => db.savePromotion({ name: { zh: "", de: "", en: "" }, percent: 10 }), /needs a name/);
  await assert.rejects(() => db.savePromotion({ name: { zh: "x", de: "", en: "" }, percent: 0 }), /1 to 100/);
});
