import { describe, expect, it } from "vitest";
import type { Product } from "@zhaoyun/domain";
import { cartKey, orderItems, summarize } from "./cart";

const dish = (id: string, priceCents: number) => ({ id, priceCents, names: { zh: id, de: id, en: id } }) as unknown as Product;
const extra = { id: "extra", name: "加面", priceCents: 250 };

describe("the guest's cart", () => {
  it("prices a dish with its options, and a reward at its options alone", () => {
    const cart = {
      [cartKey("r1", [extra])]: { productId: "r1", quantity: 2, modifiers: [extra] },
      [cartKey("n1", [], true)]: { productId: "n1", quantity: 1, modifiers: [], reward: true },
      [cartKey("gone", [])]: { productId: "gone", quantity: 3, modifiers: [] }
    };
    const summary = summarize(cart, [dish("r1", 1250), dish("n1", 990)], new Map([["n1", 50]]));
    expect(summary.totalCents).toBe(2 * 1500);
    expect(summary.count).toBe(3);
    expect(summary.points).toBe(50);
    expect(summary.rewards).toBe(1);
    expect(summary.lines.map((line) => line.product.id)).toEqual(["r1", "n1"]);
  });

  it("keeps the same dish with other options, or as a reward, on lines of its own", () => {
    expect(cartKey("r1", [])).not.toBe(cartKey("r1", [extra]));
    expect(cartKey("r1", [])).not.toBe(cartKey("r1", [], true));
  });

  it("sends the cart as the order's items, rewards marked", () => {
    expect(orderItems({ a: { productId: "n1", quantity: 1, modifiers: [extra], reward: true } })).toEqual([{ id: "n1", qty: 1, modifiers: [{ id: "extra" }], reward: true }]);
  });
});
