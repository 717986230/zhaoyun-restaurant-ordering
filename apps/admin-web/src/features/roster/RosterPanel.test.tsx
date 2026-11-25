import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminApi } from "@zhaoyun/api-client";
import type { ApiShift, PosStaff } from "@zhaoyun/contracts";
import { RosterPanel } from "./RosterPanel";

afterEach(() => { cleanup(); });

function staff(): PosStaff[] {
  return [
    { id: "s1", name: "Anna", role: "staff", active: true },
    { id: "s2", name: "Ben", role: "staff", active: true }
  ] as PosStaff[];
}

// A shift on whichever Monday the panel is showing, so it lands in the grid.
function mondayIso(): string {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

function shift(over: Partial<ApiShift> = {}): ApiShift {
  return { id: "sh1", staffId: "s1", date: mondayIso(), startMin: 540, endMin: 1020, note: "午市", minutes: 480, overnight: false, ...over };
}

function fakeApi(shifts: ApiShift[]) {
  return {
    staffList: vi.fn().mockResolvedValue({ staff: staff() }),
    shifts: vi.fn().mockResolvedValue({ shifts }),
    createShift: vi.fn().mockResolvedValue({ shift: shift() }),
    updateShift: vi.fn().mockResolvedValue({ shift: shift() }),
    deleteShift: vi.fn().mockResolvedValue(undefined)
  } as unknown as AdminApi;
}

describe("the roster view", () => {
  it("shows staff rows and a rostered shift with weekly hours", async () => {
    const { getByText } = render(<RosterPanel api={fakeApi([shift()])} notify={vi.fn()} failed={vi.fn()} />);
    await waitFor(() => expect(getByText("Anna")).toBeTruthy());
    expect(getByText("Ben")).toBeTruthy();
    expect(getByText("09:00–17:00")).toBeTruthy();
    expect(getByText("8 小时")).toBeTruthy();
  });

  it("creates a shift from the add dialog", async () => {
    const api = fakeApi([]);
    const { getAllByLabelText, getByText } = render(<RosterPanel api={api} notify={vi.fn()} failed={vi.fn()} />);
    await waitFor(() => expect(api.shifts).toHaveBeenCalled());
    fireEvent.click(getAllByLabelText("加班次")[0]!); // first empty cell
    fireEvent.click(getByText("保存"));
    await waitFor(() => expect(api.createShift).toHaveBeenCalledWith(expect.objectContaining({ staffId: "s1", startMin: 540, endMin: 1020 })));
  });

  it("deletes a shift from its cell", async () => {
    const api = fakeApi([shift()]);
    const { getByLabelText } = render(<RosterPanel api={api} notify={vi.fn()} failed={vi.fn()} />);
    await waitFor(() => expect(getByLabelText("删除")).toBeTruthy());
    fireEvent.click(getByLabelText("删除"));
    await waitFor(() => expect(api.deleteShift).toHaveBeenCalledWith("sh1"));
  });
});
