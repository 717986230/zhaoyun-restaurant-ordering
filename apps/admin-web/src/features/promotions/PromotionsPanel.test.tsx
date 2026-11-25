import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminApi } from "@zhaoyun/api-client";
import type { ApiPromotion } from "@zhaoyun/contracts";
import { PromotionsPanel } from "./PromotionsPanel";

afterEach(() => { cleanup(); });

function promo(over: Partial<ApiPromotion> = {}): ApiPromotion {
  return {
    id: "p1", name: { zh: "满惠週", de: "", en: "Happy" }, kind: "percent", percent: 10, amountCents: 0, minSpendCents: 0,
    scope: "order", category: null, activeFrom: null, activeTo: null, weekdays: [],
    startMin: null, endMin: null, enabled: true, priority: 0,
    createdAt: "2026-11-24T00:00:00Z", updatedAt: "2026-11-24T00:00:00Z", ...over
  };
}

function fakeApi(list: ApiPromotion[]) {
  return {
    promotions: vi.fn().mockResolvedValue({ promotions: list }),
    createPromotion: vi.fn().mockResolvedValue({ promotion: promo() }),
    updatePromotion: vi.fn().mockResolvedValue({ promotion: promo() }),
    deletePromotion: vi.fn().mockResolvedValue(undefined)
  } as unknown as AdminApi;
}

describe("the promotions view", () => {
  it("lists promotions with their discount", async () => {
    const { getByText } = render(<PromotionsPanel api={fakeApi([promo({ percent: 15 })])} timeZone="Europe/Vienna" notify={vi.fn()} failed={vi.fn()} />);
    await waitFor(() => expect(getByText("满惠週")).toBeTruthy());
    expect(getByText("-15%")).toBeTruthy();
  });

  it("creates a promotion from the form", async () => {
    const api = fakeApi([]);
    const { getByText, getByLabelText } = render(<PromotionsPanel api={api} timeZone="Europe/Vienna" notify={vi.fn()} failed={vi.fn()} />);
    await waitFor(() => expect(api.promotions).toHaveBeenCalled());
    fireEvent.click(getByText("新建活动"));
    fireEvent.change(getByLabelText("名称（中文）", { selector: "input" }), { target: { value: "午市折扣" } });
    fireEvent.click(getByText("保存"));
    await waitFor(() => expect(api.createPromotion).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.objectContaining({ zh: "午市折扣" }), kind: "percent", scope: "order"
    })));
  });

  it("shows a 满减 amount promotion and its threshold", async () => {
    const { getByText } = render(<PromotionsPanel api={fakeApi([promo({ kind: "amount", percent: 0, amountCents: 1000, minSpendCents: 5000, name: { zh: "满减券", de: "", en: "" } })])} timeZone="Europe/Vienna" notify={vi.fn()} failed={vi.fn()} />);
    await waitFor(() => expect(getByText("满减券")).toBeTruthy());
    expect(getByText("满 €50.00 减 €10.00")).toBeTruthy();
  });

  it("creates a 满减 amount promotion from the form", async () => {
    const api = fakeApi([]);
    const { getByText, getByLabelText } = render(<PromotionsPanel api={api} timeZone="Europe/Vienna" notify={vi.fn()} failed={vi.fn()} />);
    await waitFor(() => expect(api.promotions).toHaveBeenCalled());
    fireEvent.click(getByText("新建活动"));
    fireEvent.change(getByLabelText("名称（中文）", { selector: "input" }), { target: { value: "满100减15" } });
    fireEvent.change(getByLabelText("类型", { selector: "select" }), { target: { value: "amount" } });
    fireEvent.change(getByLabelText("减免金额（€）", { selector: "input" }), { target: { value: "15" } });
    fireEvent.change(getByLabelText("满额门槛（€，0=无门槛）", { selector: "input" }), { target: { value: "100" } });
    fireEvent.click(getByText("保存"));
    await waitFor(() => expect(api.createPromotion).toHaveBeenCalledWith(expect.objectContaining({
      kind: "amount", amountCents: 1500, minSpendCents: 10000, scope: "order"
    })));
  });

  it("pauses a live promotion through the toggle", async () => {
    const api = fakeApi([promo({ enabled: true })]);
    const { getByText } = render(<PromotionsPanel api={api} timeZone="Europe/Vienna" notify={vi.fn()} failed={vi.fn()} />);
    await waitFor(() => expect(getByText("满惠週")).toBeTruthy());
    fireEvent.click(getByText("停用"));
    await waitFor(() => expect(api.updatePromotion).toHaveBeenCalledWith("p1", expect.objectContaining({ enabled: false })));
  });
});
