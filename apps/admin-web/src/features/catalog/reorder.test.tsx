import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@zhaoyun/domain";
import { CatalogPanel } from "./CatalogPanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function dish(id: string, sortOrder: number, over: Partial<Product> = {}): Product {
  return {
    id, sku: `SKU-${id}`, kind: "food", category: "RAMEN",
    names: { zh: `菜${id}`, de: "", en: "" }, description: "", priceCents: 1000, vatPercent: 10,
    allergens: [], details: { ingredients: "", time: "", people: "", level: "" },
    appearance: { art: "", pattern: "lines" }, modifiers: [], bundleItems: [],
    available: true, published: true, sortOrder, printStation: "kitchen", media: [],
    createdAt: "", updatedAt: "", ...over
  } as unknown as Product;
}

function panel(onBulkSave: ReturnType<typeof vi.fn>, products: Product[]) {
  return render(<CatalogPanel
    products={products} editing={null} filter="all" mediaUrl={(path) => path}
    onFilter={() => undefined} onEdit={() => undefined}
    onSave={async () => true} onBulkSave={onBulkSave as never}
    onDelete={async () => undefined} onRefresh={async () => undefined} onDuplicate={async () => undefined}
    featuredIds={[]} onToggleFeatured={() => undefined}
  />);
}

describe("reordering dishes in the catalog list", () => {
  it("saves only the dishes whose place changed, as their new sortOrder", () => {
    const onBulkSave = vi.fn().mockResolvedValue(undefined);
    const products = [dish("a", 0), dish("b", 1), dish("c", 2)];
    const { getByText, getAllByLabelText } = panel(onBulkSave, products);

    fireEvent.click(getByText(/排序/));
    // Move the first dish (a) down one place → order becomes b, a, c.
    fireEvent.click(getAllByLabelText("下移")[0]!);
    fireEvent.click(getByText("保存顺序"));

    expect(onBulkSave).toHaveBeenCalledTimes(1);
    const updates = onBulkSave.mock.calls[0]![0] as Array<{ id: string; input: { sortOrder: number } }>;
    // c kept index 2, so only a and b are resent.
    expect(updates.map((u) => u.id).sort()).toEqual(["a", "b"]);
    expect(updates.find((u) => u.id === "b")!.input.sortOrder).toBe(0);
    expect(updates.find((u) => u.id === "a")!.input.sortOrder).toBe(1);
  });

  it("saves nothing and warns when the order did not change", () => {
    const onBulkSave = vi.fn().mockResolvedValue(undefined);
    const { getByText, container } = panel(onBulkSave, [dish("a", 0), dish("b", 1)]);

    fireEvent.click(getByText(/排序/));
    fireEvent.click(getByText("保存顺序"));

    expect(onBulkSave).not.toHaveBeenCalled();
    expect(container.querySelector(".sort-pane .form-error")).not.toBeNull();
  });

  it("disables ↑ on the first row and ↓ on the last", () => {
    const onBulkSave = vi.fn().mockResolvedValue(undefined);
    const { getByText, getAllByLabelText } = panel(onBulkSave, [dish("a", 0), dish("b", 1)]);

    fireEvent.click(getByText(/排序/));
    const ups = getAllByLabelText("上移") as HTMLButtonElement[];
    const downs = getAllByLabelText("下移") as HTMLButtonElement[];
    expect(ups[0]!.disabled).toBe(true);
    expect(downs[downs.length - 1]!.disabled).toBe(true);
  });
});
