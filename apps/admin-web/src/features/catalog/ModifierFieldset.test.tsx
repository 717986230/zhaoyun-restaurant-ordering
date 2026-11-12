import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Product } from "@zhaoyun/domain";
import { ModifierFieldset } from "./CatalogPanel";

// Vitest runs without globals, so RTL cannot register its own cleanup.
afterEach(cleanup);

/** What the form would submit: the hidden input the visual editor keeps in sync. */
function submitted(container: HTMLElement) {
  const field = container.querySelector('input[name="modifiers"]') as HTMLInputElement;
  return JSON.parse(field.value);
}

describe("Visual modifier editor", () => {
  it("starts a new dish with no option groups", () => {
    const { container } = render(<ModifierFieldset product={null} />);
    expect(submitted(container)).toEqual([]);
  });

  it("builds a group with a priced option the restaurant typed, not JSON", () => {
    const { container, getByText, getByLabelText, getAllByLabelText } = render(<ModifierFieldset product={null} />);

    fireEvent.click(getByText("＋ 新建规格组"));
    // The group's Chinese name and single-select default.
    fireEvent.change(getByLabelText("中文"), { target: { value: "辣度" } });
    fireEvent.click(getByText("＋ 添加选项"));

    // Now two "中文" fields exist: the group's and the option's.
    const zhFields = getAllByLabelText("中文");
    fireEvent.change(zhFields[1]!, { target: { value: "微辣" } });
    // 加价 is entered in euros and stored as cents.
    const price = container.querySelector(".modifier-price input") as HTMLInputElement;
    fireEvent.change(price, { target: { value: "1.5" } });

    const groups = submitted(container);
    expect(groups).toHaveLength(1);
    expect(groups[0].names.zh).toBe("辣度");
    expect(groups[0].selection).toBe("single");
    expect(groups[0].options).toHaveLength(1);
    expect(groups[0].options[0].names.zh).toBe("微辣");
    expect(groups[0].options[0].priceCents).toBe(150);
    expect(typeof groups[0].id).toBe("string");
    expect(groups[0].id.length).toBeGreaterThan(0);
  });

  it("loads an existing dish's groups and can switch a group to multi-select", () => {
    const product = {
      modifiers: [
        { id: "grp-add", names: { zh: "加料", de: "Extras", en: "Add-ons" }, selection: "single", options: [
          { id: "opt-egg", names: { zh: "加蛋", de: "Extra Ei", en: "Extra egg" }, priceCents: 100 }
        ] }
      ]
    } as unknown as Product;
    const { container, getByText, getByLabelText } = render(<ModifierFieldset product={product} />);

    expect(submitted(container)[0].options[0].priceCents).toBe(100);
    fireEvent.click(getByText("多选"));
    expect(submitted(container)[0].selection).toBe("multi");

    // Removing the group empties what the form submits.
    fireEvent.click(getByLabelText("删除这组"));
    expect(submitted(container)).toEqual([]);
  });

  it("marks a group 必选 and caps a multi group's 最多", () => {
    const { container, getByText, getByLabelText } = render(<ModifierFieldset product={null} />);

    fireEvent.click(getByText("＋ 新建规格组"));
    // 必选 on a single group → min 1, and no 最多 control (single is always 1).
    fireEvent.click(getByLabelText("必选"));
    expect(submitted(container)[0].min).toBe(1);
    expect(container.querySelector(".modifier-max")).toBeNull();

    // Switch to 多选, then set 最多 to 3.
    fireEvent.click(getByText("多选"));
    const max = container.querySelector(".modifier-max input") as HTMLInputElement;
    fireEvent.change(max, { target: { value: "3" } });
    const group = submitted(container)[0];
    expect(group.selection).toBe("multi");
    expect(group.min).toBe(1);
    expect(group.max).toBe(3);
  });

  it("imports valid JSON through the advanced box and rejects invalid JSON", () => {
    const { container, getByText } = render(<ModifierFieldset product={null} />);
    fireEvent.click(getByText("高级：直接编辑 JSON"));
    const box = container.querySelector(".modifier-json textarea") as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: "{ not json" } });
    fireEvent.click(getByText("应用 JSON"));
    expect(submitted(container)).toEqual([]);
    expect(container.querySelector(".modifier-json .form-error")).not.toBeNull();

    const valid = JSON.stringify([
      { id: "size", names: { zh: "份量", de: "Größe", en: "Size" }, selection: "single", options: [
        { id: "large", names: { zh: "大份", de: "Groß", en: "Large" }, priceCents: 200 }
      ] }
    ]);
    fireEvent.change(box, { target: { value: valid } });
    fireEvent.click(getByText("应用 JSON"));
    const groups = submitted(container);
    expect(groups).toHaveLength(1);
    expect(groups[0].options[0].priceCents).toBe(200);
  });
});
