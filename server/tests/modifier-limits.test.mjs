import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProduct, resolveModifiers } from "../../shared/products.mjs";

/** A product row as the DB stores it, with the given modifier groups. */
function row(groups) {
  return { sku: "TEST-1", modifiers_json: JSON.stringify(groups) };
}

const spice = {
  id: "spice",
  names: { zh: "辣度", de: "Schärfe", en: "Spice" },
  selection: "single",
  min: 1,
  options: [
    { id: "mild", names: { zh: "微辣", de: "Mild", en: "Mild" }, priceCents: 0 },
    { id: "hot", names: { zh: "特辣", de: "Scharf", en: "Hot" }, priceCents: 0 }
  ]
};

const addons = {
  id: "addons",
  names: { zh: "加料", de: "Extras", en: "Add-ons" },
  selection: "multi",
  max: 2,
  options: [
    { id: "egg", names: { zh: "加蛋", de: "Ei", en: "Egg" }, priceCents: 100 },
    { id: "noodle", names: { zh: "加面", de: "Nudeln", en: "Noodles" }, priceCents: 200 },
    { id: "beef", names: { zh: "加牛肉", de: "Rind", en: "Beef" }, priceCents: 300 }
  ]
};

test("a required (必选) group rejects an order that skips it", () => {
  assert.throws(() => resolveModifiers(row([spice]), []), /At least 1/);
  // Picking one satisfies it.
  assert.deepEqual(resolveModifiers(row([spice]), [{ id: "mild" }]).map((m) => m.id), ["mild"]);
});

test("a 最多 (max) group rejects more picks than allowed", () => {
  assert.throws(() => resolveModifiers(row([addons]), [{ id: "egg" }, { id: "noodle" }, { id: "beef" }]), /At most 2/);
  // Two is fine.
  assert.equal(resolveModifiers(row([addons]), [{ id: "egg" }, { id: "noodle" }]).length, 2);
});

test("normalizeProduct keeps only positive integer min/max, and never max on a single group", () => {
  const out = normalizeProduct({
    sku: "N1", kind: "food", category: "RAMEN", names: { zh: "拉面" },
    modifiers: [
      { ...spice, min: 1, max: 5 },                 // single: max dropped, min kept
      { ...addons, min: 0, max: 2 }                 // multi: min 0 dropped, max kept
    ]
  }, {});
  const stored = JSON.parse(out.modifiersJson);
  assert.equal(stored[0].min, 1);
  assert.equal(stored[0].max, undefined, "a single group never stores a max");
  assert.equal(stored[1].min, undefined, "min 0 is not stored");
  assert.equal(stored[1].max, 2);
});

test("a group with no limits behaves exactly as before", () => {
  const plain = { ...addons };
  delete plain.max;
  assert.equal(resolveModifiers(row([plain]), [{ id: "egg" }, { id: "noodle" }, { id: "beef" }]).length, 3);
  assert.deepEqual(resolveModifiers(row([plain]), []), []);
});
