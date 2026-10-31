import { describe, expect, it } from "vitest";
import type { ApiOrder } from "@zhaoyun/contracts";
import { announceDiff, announceText, nextAnnounceMode, pendingNew } from "./announce";

function order(id: string, status: ApiOrder["status"], agoMs: number, extra: Partial<ApiOrder> = {}): ApiOrder {
  return {
    id, clientRequestId: id, no: id, table: "1", status, note: "", total: 0, items: [],
    createdAt: new Date(Date.now() - agoMs).toISOString(), ...extra
  };
}

const NOW = Date.now();
const OVERDUE = 180_000;

describe("pendingNew", () => {
  it("keeps only orders the kitchen has not started", () => {
    const orders = [order("a", "new", 0), order("b", "preparing", 0), order("c", "ready", 0), order("d", "cancelled", 0)];
    expect(pendingNew(orders).map((o) => o.id)).toEqual(["a"]);
  });
});

describe("announceDiff", () => {
  it("calls an unseen pending order fresh, not overdue", () => {
    const { fresh, overdue } = announceDiff([order("a", "new", 999_999)], new Set(), new Map(), NOW, OVERDUE);
    expect(fresh.map((o) => o.id)).toEqual(["a"]);
    expect(overdue).toEqual([]);
  });

  it("does not re-announce a seen order until it is overdue", () => {
    const seen = new Set(["a"]);
    const young = announceDiff([order("a", "new", 10_000)], seen, new Map(), NOW, OVERDUE);
    expect(young.fresh).toEqual([]);
    expect(young.overdue).toEqual([]);
  });

  it("nudges a seen order that has waited past the window", () => {
    const seen = new Set(["a"]);
    const { fresh, overdue } = announceDiff([order("a", "new", 200_000)], seen, new Map(), NOW, OVERDUE);
    expect(fresh).toEqual([]);
    expect(overdue.map((o) => o.id)).toEqual(["a"]);
  });

  it("does not nudge again within the window of the last nudge", () => {
    const seen = new Set(["a"]);
    const nudgedAt = new Map([["a", NOW - 10_000]]);
    const { overdue } = announceDiff([order("a", "new", 200_000)], seen, nudgedAt, NOW, OVERDUE);
    expect(overdue).toEqual([]);
  });

  it("ignores orders the kitchen has already started", () => {
    const seen = new Set(["a"]);
    const { fresh, overdue } = announceDiff([order("a", "preparing", 200_000)], seen, new Map(), NOW, OVERDUE);
    expect(fresh).toEqual([]);
    expect(overdue).toEqual([]);
  });
});

describe("announceText", () => {
  it("names a single fresh table in Chinese", () => {
    expect(announceText("zh", [order("a", "new", 0, { table: "7" })], [])).toBe("7桌，新订单");
  });
  it("names a pickup by its pickup number", () => {
    expect(announceText("zh", [order("a", "new", 0, { channel: "pickup", pickupNo: 42 })], [])).toBe("取餐42号，新订单");
  });
  it("counts several fresh orders instead of naming each", () => {
    expect(announceText("en", [order("a", "new", 0), order("b", "new", 0)], [])).toBe("2 new orders");
  });
  it("adds a waiting nudge after the fresh part", () => {
    expect(announceText("zh", [order("a", "new", 0, { table: "3" })], [order("b", "new", 0, { table: "5" })])).toBe("3桌，新订单，5桌催单");
  });
});

describe("nextAnnounceMode", () => {
  it("cycles off → beep → voice → off", () => {
    expect(nextAnnounceMode("off")).toBe("beep");
    expect(nextAnnounceMode("beep")).toBe("voice");
    expect(nextAnnounceMode("voice")).toBe("off");
  });
});
