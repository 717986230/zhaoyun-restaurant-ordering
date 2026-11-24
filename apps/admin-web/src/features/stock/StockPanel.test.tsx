import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminApi } from "@zhaoyun/api-client";
import type { Product } from "@zhaoyun/domain";
import { StockPanel } from "./StockPanel";

afterEach(() => { cleanup(); });

function dish(id: string, over: Partial<Product> = {}): Product {
  return {
    id, sku: `SKU-${id}`, kind: "food", category: "RAMEN",
    names: { zh: `菜${id}`, de: "", en: "" }, description: "", priceCents: 1000, vatPercent: 10,
    allergens: [], details: { ingredients: "", time: "", people: "", level: "" },
    appearance: { art: "", pattern: "lines" }, modifiers: [], bundleItems: [],
    available: true, published: true, printStation: "kitchen", media: [],
    createdAt: "", updatedAt: "", ...over
  } as unknown as Product;
}

function fakeApi() {
  return {
    setProductStock: vi.fn().mockResolvedValue({ product: {} }),
    updateProduct: vi.fn().mockResolvedValue({ product: {} })
  } as unknown as AdminApi;
}

const products = [
  dish("sold", { available: false }),
  dish("low", { dailyLimit: 10, leftToday: 3 }),
  dish("out", { dailyLimit: 20, leftToday: 0 }),
  dish("ok", { dailyLimit: 50, leftToday: 40 }),
  dish("plain")
];

describe("the stock view", () => {
  it("counts sold-out, out-today and low dishes, and lists only tracked ones", () => {
    const { getByText, container } = render(<StockPanel api={fakeApi()} products={products} onRefresh={vi.fn()} notify={vi.fn()} failed={vi.fn()} />);
    // 沽清中 tile = 1, 今日售罄 = 1, 低库存 (≤5) = 1, 限量 = 3 (low, out, ok).
    const tiles = [...container.querySelectorAll(".report-tile b")].map((b) => b.textContent);
    expect(tiles).toEqual(["1", "1", "1", "3"]);
    // The plain dish (no limit, available) is not listed; the four tracked ones are.
    expect(getByText("菜sold")).toBeTruthy();
    expect(() => getByText("菜plain")).toThrow();
  });

  it("restores a sold-out dish to available", async () => {
    const api = fakeApi();
    const { getByText } = render(<StockPanel api={api} products={products} onRefresh={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} failed={vi.fn()} />);
    fireEvent.click(getByText("恢复供应"));
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledWith("sold", expect.objectContaining({ available: true })));
  });

  it("refills a limited dish to its daily limit", async () => {
    const api = fakeApi();
    const { getAllByText } = render(<StockPanel api={api} products={products} onRefresh={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} failed={vi.fn()} />);
    fireEvent.click(getAllByText("恢复满量")[0]!);
    await waitFor(() => expect(api.setProductStock).toHaveBeenCalledWith(expect.any(String), { leftToday: expect.any(Number) }));
  });

  it("saves an edited daily limit / left-today", async () => {
    const api = fakeApi();
    const { getAllByLabelText, getAllByText } = render(<StockPanel api={api} products={products} onRefresh={vi.fn().mockResolvedValue(undefined)} notify={vi.fn()} failed={vi.fn()} />);
    const leftInputs = getAllByLabelText("今日剩余");
    fireEvent.change(leftInputs[0]!, { target: { value: "7" } });
    fireEvent.click(getAllByText("保存")[0]!);
    await waitFor(() => expect(api.setProductStock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ leftToday: 7 })));
  });
});
