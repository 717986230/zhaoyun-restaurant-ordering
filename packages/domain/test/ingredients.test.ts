import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deconstruct, ingredients, ingredientTerms } from "../src/ingredients.js";

interface SeededProduct { sku: string; names: { de: string }; allergens: string[]; details: { ingredients: string } }
const catalog: SeededProduct[] = JSON.parse(readFileSync(resolve(process.cwd(), "apps/customer-app/src/app/bundled-catalog.json"), "utf8"));

describe("the ingredient glossary", () => {
  it("covers every term the menu actually uses", () => {
    // This is the test that makes the glossary a maintained thing rather than a
    // snapshot: add a dish with an ingredient nobody has translated, and the
    // build says so instead of the tablet showing a German word to a guest
    // reading Chinese.
    const unknown = new Set<string>();
    for (const product of catalog) {
      for (const term of ingredientTerms(product.details.ingredients)) {
        if (!ingredients[term]) unknown.add(term);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it("never invents an allergen the kitchen did not declare", () => {
    // The declaration is a legal statement. The glossary may explain it and
    // nothing more, so no dish may come out of `deconstruct` carrying a letter
    // its own row does not have.
    for (const product of catalog) {
      const declared = new Set(product.allergens);
      const { parts, portions } = deconstruct(product);
      for (const part of [...parts, ...portions]) {
        for (const code of part.allergens) {
          expect(declared.has(code), `${product.sku} ${part.de} claims ${code}`).toBe(true);
        }
      }
    }
  });

  it("accounts for most of what is declared, and hands back the rest", () => {
    const { parts, unattributed } = deconstruct({
      details: { ingredients: "Ramen, Gemüse, Ei" },
      allergens: ["A", "C", "F"]
    });
    expect(parts.map((part) => part.zh)).toEqual(["拉面", "蔬菜", "鸡蛋"]);
    expect(parts[0].allergens).toEqual(["A"]);
    expect(parts[1].allergens).toEqual([]);
    expect(parts[2].allergens).toEqual(["C"]);
    // Soy is in the broth, which the ingredient line does not name. Saying so
    // is the point: the guest still sees F, and the gap is visible to whoever
    // maintains the menu.
    expect(unattributed).toEqual(["F"]);
  });

  it("keeps a serving size out of the ingredients", () => {
    const { parts, portions } = deconstruct({ details: { ingredients: "Kaffee, Milch, 0.25L" }, allergens: ["G"] });
    expect(parts.map((part) => part.de)).toEqual(["Kaffee", "Milch"]);
    expect(portions.map((part) => part.en)).toEqual(["0.25 l"]);
  });

  it("leaves an unknown term readable rather than dropping it", () => {
    const { parts } = deconstruct({ details: { ingredients: "Ramen, Yuzu-Kosho" }, allergens: ["A"] });
    expect(parts[1]).toEqual({ de: "Yuzu-Kosho", zh: "Yuzu-Kosho", en: "Yuzu-Kosho", allergens: [], unknown: true });
  });
});

describe("the whole seeded menu", () => {
  it("leaves roughly half of what is declared unattributed, and that is the data", () => {
    // 54% of the letters on this menu cannot be pinned to a named ingredient,
    // and almost all of them are A, F and N — wheat, soy and sesame, which is
    // to say soy sauce and sesame oil. The printed menu names what a guest can
    // see in the bowl and not what the wok was seasoned with, so the gap is a
    // property of the source and not of the glossary. This is a smoke alarm,
    // not a target: it catches the glossary rotting, and the honest fix for
    // the rest is the kitchen filling in the ingredient lines.
    const totals = catalog.reduce((sum, product) => {
      const { unattributed } = deconstruct(product);
      return { declared: sum.declared + product.allergens.length, loose: sum.loose + unattributed.length };
    }, { declared: 0, loose: 0 });
    expect(totals.loose / totals.declared).toBeLessThan(0.6);
  });
});
