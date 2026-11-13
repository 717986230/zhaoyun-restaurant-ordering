import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@zhaoyun/domain";
import { CatalogPanel, nextPriceCents } from "./CatalogPanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("bulk price maths", () => {
  it("adds and subtracts a fixed euro amount, in cents", () => {
    expect(nextPriceCents(1000, "fixed", 1)).toBe(1100);
    expect(nextPriceCents(1000, "fixed", -0.5)).toBe(950);
  });

  it("changes by a percentage and rounds to the cent", () => {
    expect(nextPriceCents(1000, "percent", 10)).toBe(1100);
    expect(nextPriceCents(1000, "percent", -20)).toBe(800);
    expect(nextPriceCents(999, "percent", 10)).toBe(1099);
  });

  it("never drops below zero", () => {
    expect(nextPriceCents(500, "fixed", -9)).toBe(0);
    expect(nextPriceCents(500, "percent", -200)).toBe(0);
  });
});

function dish(id: string, priceCents: number, over: Partial<Product> = {}): Product {
  return {
    id, sku: `SKU-${id}`, kind: "food", category: "RAMEN",
    names: { zh: `菜${id}`, de: "", en: "" }, description: "", priceCents, vatPercent: 10,
    allergens: [], details: { ingredients: "", time: "", people: "", level: "" },
    appearance: { art: "", pattern: "lines" }, modifiers: [], bundleItems: [],
    available: true, published: true, sortOrder: 0, printStation: "kitchen", media: [],
    createdAt: "", updatedAt: "", ...over
  } as unknown as Product;
}

function panel(onBulkSave: ReturnType<typeof vi.fn>, products: Product[]) {
  return render(<CatalogPanel
    products={products} printers={[]} editing={null} filter="all" mediaUrl={(path) => path}
    onFilter={() => undefined} onEdit={() => undefined}
    onSave={async () => true} onBulkSave={onBulkSave as never}
    onDelete={async () => undefined} onRefresh={async () => undefined} onDuplicate={async () => undefined}
    featuredIds={[]} onToggleFeatured={() => undefined}
  />);
}

describe("bulk editing in the catalog list", () => {
  it("resends a fixed +€1 price for every selected dish, touching nothing else", () => {
    vi.stubGlobal("confirm", () => true);
    const onBulkSave = vi.fn().mockResolvedValue(undefined);
    const products = [dish("a", 1000), dish("b", 500, { kind: "drink", vatPercent: 20, printStation: "bar" })];
    const { getByText, container } = panel(onBulkSave, products);

    fireEvent.click(getByText(/批量/));
    fireEvent.click(getByText("全选"));
    const priceInput = container.querySelector(".batch-price input") as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "1" } });
    fireEvent.click(getByText("改价"));

    expect(onBulkSave).toHaveBeenCalledTimes(1);
    const updates = onBulkSave.mock.calls[0]![0] as Array<{ id: string; input: { price: number; published: boolean; vatPercent: number } }>;
    expect(updates.map((u) => u.id).sort()).toEqual(["a", "b"]);
    expect(updates.find((u) => u.id === "a")!.input.price).toBe(11);
    expect(updates.find((u) => u.id === "b")!.input.price).toBe(6);
    // The dish is resent whole, so its other fields ride along unchanged.
    expect(updates.find((u) => u.id === "b")!.input.vatPercent).toBe(20);
    expect(updates.find((u) => u.id === "a")!.input.published).toBe(true);
  });

  it("takes selected dishes off the menu with one 下架", () => {
    vi.stubGlobal("confirm", () => true);
    const onBulkSave = vi.fn().mockResolvedValue(undefined);
    const { getByText } = panel(onBulkSave, [dish("a", 1000), dish("b", 500)]);

    fireEvent.click(getByText(/批量/));
    fireEvent.click(getByText("全选"));
    fireEvent.click(getByText("下架"));

    const updates = onBulkSave.mock.calls[0]![0] as Array<{ input: { published: boolean } }>;
    expect(updates).toHaveLength(2);
    expect(updates.every((u) => u.input.published === false)).toBe(true);
  });

  it("rejects an empty or zero price change and saves nothing", () => {
    vi.stubGlobal("confirm", () => true);
    const onBulkSave = vi.fn().mockResolvedValue(undefined);
    const { getByText, container } = panel(onBulkSave, [dish("a", 1000)]);

    fireEvent.click(getByText(/批量/));
    fireEvent.click(getByText("全选"));
    const priceInput = container.querySelector(".batch-price input") as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "0" } });
    fireEvent.click(getByText("改价"));

    expect(onBulkSave).not.toHaveBeenCalled();
    expect(container.querySelector(".batch-bar .form-error")).not.toBeNull();
  });
});
