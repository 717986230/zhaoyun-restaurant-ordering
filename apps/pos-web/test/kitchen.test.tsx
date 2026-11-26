import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiOrder } from "@zhaoyun/contracts";
import {
  KDS_OVERDUE_MINUTES, batchSummary, groupByStation, isOverdue, minutesWaiting, nextStatus, openOrders, soldOutProducts, Kitchen
} from "../src/Kitchen";

// Vitest runs without globals, so RTL cannot register its own cleanup.
afterEach(cleanup);

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function order(overrides: Partial<ApiOrder> = {}): ApiOrder {
  return {
    id: "o1", clientRequestId: "c1", no: "251118-O1", table: "05", status: "new", note: "",
    total: 20, createdAt: ago(25), items: [
      { id: "p1", name: "拉面", qty: 2, printStation: "kitchen" },
      { id: "p2", name: "寿司", qty: 1, printStation: "sushi", held: true }
    ],
    ...overrides
  } as ApiOrder;
}

describe("KDS board logic (no browser needed)", () => {
  it("steps the order along new → preparing → ready → completed, then stops", () => {
    expect(nextStatus("new")).toBe("preparing");
    expect(nextStatus("preparing")).toBe("ready");
    expect(nextStatus("ready")).toBe("completed");
    expect(nextStatus("completed")).toBeNull();
    expect(nextStatus("cancelled")).toBeNull();
  });

  it("keeps only open orders, oldest first", () => {
    const done = order({ id: "o2", status: "completed", createdAt: ago(5) });
    const fresh = order({ id: "o3", status: "new", createdAt: ago(2) });
    const old = order({ id: "o4", status: "preparing", createdAt: ago(40) });
    expect(openOrders([done, fresh, old]).map((entry) => entry.id)).toEqual(["o4", "o3"]);
  });

  it("goes red after 20 minutes waiting — but a ready order never does", () => {
    expect(KDS_OVERDUE_MINUTES).toBe(20);
    expect(minutesWaiting(order(), Date.now())).toBe(25);
    expect(isOverdue(order())).toBe(true);
    expect(isOverdue(order({ status: "ready" }))).toBe(false);
    expect(isOverdue(order({ createdAt: ago(5) }))).toBe(false);
  });

  it("splits one order across its stations, and keeps the held line visible as 等叫", () => {
    const columns = groupByStation([order()]);
    expect(columns.map((column) => column.station)).toEqual(["kitchen", "sushi"]);
    const sushi = columns.find((column) => column.station === "sushi")!;
    expect(sushi.cards[0].items[0].held).toBe(true);
    // A line with no station cooks at the kitchen.
    const noStation = order({ items: [{ id: "p9", name: "汤", qty: 1 }] });
    expect(groupByStation([noStation]).map((column) => column.station)).toEqual(["kitchen"]);
  });

  it("totals open non-held dishes across stations for batch cooking, highest first", () => {
    const o1 = order({ id: "o1", status: "new", items: [{ id: "p1", name: "拉面", qty: 2, printStation: "kitchen" }, { id: "p2", name: "寿司", qty: 1, printStation: "sushi", held: true }] });
    const o2 = order({ id: "o2", status: "preparing", items: [{ id: "p1", name: "拉面", qty: 3, printStation: "kitchen" }, { id: "p4", name: "水煮牛肉", qty: 1, printStation: "kitchen" }] });
    const o3 = order({ id: "o3", status: "ready", items: [{ id: "p5", name: "可乐", qty: 4, printStation: "bar" }] });
    expect(batchSummary(groupByStation([o1, o2, o3]))).toEqual([
      { name: "拉面", qty: 5 },
      { name: "水煮牛肉", qty: 1 }
    ]);
  });

  it("marks sold out in red: switched off, or counted down to zero today", () => {
    const products = [
      { id: "a", sku: "A", available: false, names: { zh: "甲", de: "A", en: "A" } },
      { id: "b", sku: "B", available: true, leftToday: 0, names: { zh: "乙", de: "B", en: "B" } },
      { id: "c", sku: "C", available: true, leftToday: 3, names: { zh: "丙", de: "C", en: "C" } },
      { id: "d", sku: "D", available: true, names: { zh: "丁", de: "D", en: "D" } }
    ] as never;
    expect(soldOutProducts(products).map((product) => product.id)).toEqual(["a", "b"]);
  });
});

describe("KDS board on screen", () => {
  const orders = [order(), order({ id: "o2", table: "08", status: "ready", createdAt: ago(3), items: [{ id: "p3", name: "啤酒", qty: 1, printStation: "bar" }] })];

  beforeEach(() => {
    sessionStorage.setItem("zy_kitchen_token", "kitchen-token");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (url.includes("/api/pos/catalog")) return { status: 403, ok: false, json: async () => ({}) } as Response;
      if (url.includes("/api/orders/") && init?.method === "PATCH") return { status: 200, ok: true, json: async () => ({ order: orders[0] }) } as Response;
      return { status: 200, ok: true, json: async () => ({ orders }) } as Response;
    }));
    (globalThis as unknown as { __kdsCalls: unknown }).__kdsCalls = calls;
  });
  afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

  it("shows each station's cards, the held line as 等叫, and the overdue order in red", async () => {
    const { findAllByText, getByText, getAllByText } = render(<Kitchen />);
    // Order o1 touches two stations, so it has one card per station.
    expect((await findAllByText("桌 05")).length).toBe(2);
    expect(getAllByText("厨房").length).toBeGreaterThan(0);
    expect(getAllByText("寿司台").length).toBeGreaterThan(0);
    expect(getAllByText("吧台").length).toBeGreaterThan(0);
    // The held sushi line is marked 等叫, not cooked; the 25-minute-old
    // order is past the 20-minute line and says so.
    expect(getAllByText("等叫", { exact: false }).length).toBe(2); // card badge + the held line itself
    expect(getByText("拉面 ×2")).toBeTruthy();
    expect(getAllByText("超时 5 分钟", { exact: false }).length).toBe(2);
    // A kitchen token cannot read the sold-out list: the board says so
    // instead of failing.
    expect(getByText("售罄列表需跑堂 / 店主令牌；当前厨房令牌只看订单。")).toBeTruthy();
  });

  it("advances an order with the kitchen token when the cook taps 开始做", async () => {
    const { findAllByText } = render(<Kitchen />);
    const buttons = await findAllByText("开始做");
    expect(buttons.length).toBe(2); // one card per station the order touches
    fireEvent.click(buttons[0]);
    const calls = (globalThis as unknown as { __kdsCalls: Array<{ url: string; method: string; body?: string }> }).__kdsCalls;
    await vi.waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH");
      expect(patch?.url).toContain("/api/orders/o1/status");
      expect(patch?.body).toBe(JSON.stringify({ status: "preparing" }));
    });
  });

  it("asks for account sign-in first, and wrong credentials are refused", async () => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401, ok: false, json: async () => ({}) } as Response)));
    const { findByText, getByText, getByLabelText } = render(<Kitchen />);
    expect(getByText("厨房看板")).toBeTruthy();
    fireEvent.change(getByLabelText("账户名"), { target: { value: "chef" } });
    fireEvent.change(getByLabelText("账户密码"), { target: { value: "nope" } });
    fireEvent.click(getByText("进入厨房看板"));
    expect(await findByText("账户名或密码不对")).toBeTruthy();
  });
});
