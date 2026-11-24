import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminApi } from "@zhaoyun/api-client";
import type { ApiReceipt } from "@zhaoyun/contracts";
import { OrdersPanel } from "./OrdersPanel";

afterEach(() => { cleanup(); });

function receipt(over: Partial<ApiReceipt> = {}): ApiReceipt {
  return {
    id: "r1", receiptNo: 7, cashRegisterId: "reg", type: "sale", table: "A3",
    lines: [{ kind: "item", name: "汤面", quantity: 2, unitPriceCents: 500, totalCents: 1000, vatSplit: [{ percent: 10, cents: 91 }] }],
    vat: [{ percent: 10, grossCents: 1000, netCents: 909, vatCents: 91 }],
    totalCents: 1000, payments: [{ type: "cash", amountCents: 1000 }],
    refersTo: null, refersToNo: null, reason: null, cancelledBy: null,
    fiscalStatus: "unsigned", staffRole: "manager", staffId: "s1", staffName: "阿花",
    createdAt: "2026-11-24T10:00:00.000Z", ...over
  } as ApiReceipt;
}

function fakeApi(receipts: ApiReceipt[]) {
  return {
    receipts: vi.fn().mockResolvedValue({ receipts }),
    reprintReceipt: vi.fn().mockResolvedValue(undefined)
  } as unknown as AdminApi;
}

describe("the back office's order lookup", () => {
  it("loads today's bills on open and shows each one", async () => {
    const api = fakeApi([receipt()]);
    const { findByText } = render(<OrdersPanel api={api} timeZone="Europe/Vienna" failed={vi.fn()} notify={vi.fn()} />);
    await findByText("#7");
    // The first load asked for a day range (today), not an empty query.
    const query = (api.receipts as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as { from?: string; to?: string };
    expect(query.from).toBeTruthy();
    expect(query.to).toBe(query.from);
  });

  it("reprints a receipt and tells the user", async () => {
    const api = fakeApi([receipt()]);
    const notify = vi.fn();
    const { findAllByText } = render(<OrdersPanel api={api} timeZone="Europe/Vienna" failed={vi.fn()} notify={notify} />);
    const buttons = await findAllByText("重打");
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(api.reprintReceipt).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining("7")));
  });

  it("re-queries with the chosen payment type", async () => {
    const api = fakeApi([receipt()]);
    const { findByText, getByDisplayValue } = render(<OrdersPanel api={api} timeZone="Europe/Vienna" failed={vi.fn()} notify={vi.fn()} />);
    await findByText("#7");
    fireEvent.change(getByDisplayValue("全部付款方式"), { target: { value: "card" } });
    await waitFor(() => expect((api.receipts as unknown as { mock: { calls: Array<[{ payment?: string }]> } }).mock.calls.some((call) => call[0]?.payment === "card")).toBe(true));
  });
});
