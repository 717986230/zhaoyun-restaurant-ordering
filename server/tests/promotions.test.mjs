import test from "node:test";
import assert from "node:assert/strict";
import { promotionActive, bestOrderPromotion, promotionView, normalizePromotion, localClock } from "../../shared/promotions.mjs";

const TZ = "Europe/Vienna";

function promo(over = {}) {
  return {
    id: "p1", name: { zh: "满惠", de: "", en: "" }, kind: "percent", percent: 10,
    scope: "order", category: null, activeFrom: null, activeTo: null,
    weekdays: [], startMin: null, endMin: null, enabled: true, priority: 0,
    updatedAt: "2026-11-24T00:00:00Z", ...over
  };
}

test("localClock reads the wall clock in the restaurant time zone", () => {
  // 2026-11-24 is a Tuesday. 12:30 UTC is 13:30 in Vienna (winter, UTC+1).
  const clock = localClock(TZ)("2026-11-24T12:30:00Z");
  assert.equal(clock.date, "2026-11-24");
  assert.equal(clock.weekday, 2); // Tuesday
  assert.equal(clock.minutes, 13 * 60 + 30);
});

test("a plain enabled promotion is always live", () => {
  assert.equal(promotionActive(promo(), "2026-11-24T12:00:00Z", TZ), true);
});

test("a disabled promotion is never live", () => {
  assert.equal(promotionActive(promo({ enabled: false }), "2026-11-24T12:00:00Z", TZ), false);
});

test("the date window is inclusive and either end may be open", () => {
  const p = promo({ activeFrom: "2026-11-24", activeTo: "2026-11-24" });
  assert.equal(promotionActive(p, "2026-11-24T08:00:00Z", TZ), true);
  assert.equal(promotionActive(p, "2026-11-23T20:00:00Z", TZ), false); // 21:00 Vienna, still the 23rd
  assert.equal(promotionActive(p, "2026-11-25T08:00:00Z", TZ), false);
  assert.equal(promotionActive(promo({ activeFrom: "2026-11-24" }), "2030-01-01T00:00:00Z", TZ), true);
});

test("weekdays restrict the promotion to the days chosen, read locally", () => {
  const friday = promo({ weekdays: [5] }); // Friday only
  assert.equal(promotionActive(friday, "2026-11-27T12:00:00Z", TZ), true);  // 2026-11-27 is a Friday
  assert.equal(promotionActive(friday, "2026-11-24T12:00:00Z", TZ), false); // Tuesday
});

test("a time band keeps the promotion to its hours, and may wrap past midnight", () => {
  const lunch = promo({ startMin: 11 * 60, endMin: 14 * 60 });
  assert.equal(promotionActive(lunch, "2026-11-24T11:00:00Z", TZ), true);  // 12:00 Vienna
  assert.equal(promotionActive(lunch, "2026-11-24T06:00:00Z", TZ), false); // 07:00 Vienna, before 11:00
  const late = promo({ startMin: 22 * 60, endMin: 2 * 60 }); // 22:00–02:00
  assert.equal(promotionActive(late, "2026-11-24T22:30:00Z", TZ), true);  // 23:30 Vienna
  assert.equal(promotionActive(late, "2026-11-25T00:30:00Z", TZ), true);  // 01:30 Vienna
  assert.equal(promotionActive(late, "2026-11-24T15:00:00Z", TZ), false); // 16:00 Vienna
});

test("bestOrderPromotion picks the biggest percent among the live ones", () => {
  const promos = [
    promo({ id: "a", percent: 10 }),
    promo({ id: "b", percent: 20 }),
    promo({ id: "c", percent: 15, enabled: false })
  ];
  const win = bestOrderPromotion(promos, { at: "2026-11-24T12:00:00Z", timeZone: TZ });
  assert.equal(win.id, "b");
  assert.equal(win.percent, 20);
  assert.deepEqual(win.name, { zh: "满惠", de: "", en: "" });
});

test("bestOrderPromotion breaks a percent tie by priority then recency", () => {
  const promos = [
    promo({ id: "a", percent: 10, priority: 1, updatedAt: "2026-11-01T00:00:00Z" }),
    promo({ id: "b", percent: 10, priority: 5, updatedAt: "2026-11-01T00:00:00Z" }),
    promo({ id: "c", percent: 10, priority: 5, updatedAt: "2026-11-20T00:00:00Z" })
  ];
  assert.equal(bestOrderPromotion(promos, { at: "2026-11-24T12:00:00Z", timeZone: TZ }).id, "c");
});

test("bestOrderPromotion returns null when nothing is live", () => {
  assert.equal(bestOrderPromotion([promo({ enabled: false })], { at: "2026-11-24T12:00:00Z", timeZone: TZ }), null);
  assert.equal(bestOrderPromotion([], { at: "2026-11-24T12:00:00Z", timeZone: TZ }), null);
});

test("promotionView shapes a stored row, reading percent out of config", () => {
  const view = promotionView({
    id: "p1", name_zh: "满惠", name_de: "", name_en: "Happy", kind: "percent",
    config_json: JSON.stringify({ percent: 15 }), scope: "order", category: null,
    active_from: "2026-11-24", active_to: null, weekdays: "1,5", start_min: 660, end_min: 840,
    enabled: 1, priority: 2, created_at: "x", updated_at: "y"
  });
  assert.equal(view.percent, 15);
  assert.deepEqual(view.weekdays, [1, 5]);
  assert.equal(view.startMin, 660);
  assert.equal(view.enabled, true);
});

test("normalizePromotion validates and lays out the columns", () => {
  const row = normalizePromotion({
    name: { zh: "满惠週", de: "", en: "" }, kind: "percent", percent: 12,
    scope: "order", activeFrom: "2026-11-24", activeTo: "2026-12-01",
    weekdays: [5, 1, 5], startMin: 660, endMin: 840, enabled: true, priority: 3
  });
  assert.equal(row.name_zh, "满惠週");
  assert.equal(JSON.parse(row.config_json).percent, 12);
  assert.equal(row.weekdays, "1,5"); // deduped and sorted
  assert.equal(row.enabled, 1);
});

test("normalizePromotion rejects bad input", () => {
  assert.throws(() => normalizePromotion({ name: { zh: "", de: "", en: "" }, percent: 10 }), /needs a name/);
  assert.throws(() => normalizePromotion({ name: { zh: "x" }, percent: 0 }), /1 to 100/);
  assert.throws(() => normalizePromotion({ name: { zh: "x" }, percent: 150 }), /1 to 100/);
  assert.throws(() => normalizePromotion({ name: { zh: "x" }, percent: 10, activeFrom: "2026-12-01", activeTo: "2026-11-01" }), /end date is before/);
  assert.throws(() => normalizePromotion({ name: { zh: "x" }, percent: 10, startMin: 660 }), /start and an end/);
  assert.throws(() => normalizePromotion({ name: { zh: "x" }, percent: 10, startMin: 660, endMin: 2000 }), /00:00 to 23:59/);
});
