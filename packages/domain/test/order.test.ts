import { describe, expect, it } from "vitest";
import { canTransitionOrder, nextOperationalStatus, summarizeCart } from "../src/index";
import type { Product } from "../src/index";

const product: Product = {
  id: "beef",
  sku: "FOOD-80",
  kind: "food",
  category: "MAIN",
  names: { zh: "黑椒牛柳", de: "Rinderfilet", en: "Beef fillet" },
  description: "",
  priceCents: 3450,
  allergens: [],
  details: { time: "35 min", people: "2", level: "Mittel", ingredients: "Rind" },
  appearance: { art: "#111", pattern: "ring" },
  media: [],
  available: true,
  published: true,
  printStation: "kitchen"
};

describe("Order state machine", () => {
  it("allows only forward operational transitions", () => {
    expect(canTransitionOrder("new", "preparing")).toBe(true);
    expect(canTransitionOrder("preparing", "new")).toBe(false);
    expect(nextOperationalStatus("ready")).toBe("completed");
    expect(nextOperationalStatus("sync-failed")).toBeNull();
  });

  it("calculates totals in integer cents", () => {
    expect(summarizeCart([{ productId: "beef", quantity: 2 }], [product])).toEqual({ count: 2, totalCents: 6900 });
  });
});
