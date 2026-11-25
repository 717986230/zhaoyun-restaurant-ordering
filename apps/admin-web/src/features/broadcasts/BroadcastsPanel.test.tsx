import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminApi } from "@zhaoyun/api-client";
import type { ApiBroadcast } from "@zhaoyun/contracts";
import { BroadcastsPanel } from "./BroadcastsPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function cast(over: Partial<ApiBroadcast> = {}): ApiBroadcast {
  return {
    id: "b1", subject: "本周特惠", body: "欢迎回来。", segment: {}, status: "sent",
    audience: 12, sent: 11, createdAt: "2026-11-24T00:00:00Z", sentAt: "2026-11-24T10:00:00Z", ...over
  };
}

function fakeApi(list: ApiBroadcast[]) {
  return {
    broadcasts: vi.fn().mockResolvedValue({ broadcasts: list }),
    createBroadcast: vi.fn().mockResolvedValue({ broadcast: cast({ status: "draft" }) }),
    sendBroadcast: vi.fn().mockResolvedValue({ broadcast: cast({ sent: 11 }) }),
    deleteBroadcast: vi.fn().mockResolvedValue(undefined),
    previewSegment: vi.fn().mockResolvedValue({ total: 20, reachable: 12, sample: ["张三", "李四"] })
  } as unknown as AdminApi;
}

describe("the broadcasts view", () => {
  it("lists past broadcasts with their reach", async () => {
    const { getByText } = render(<BroadcastsPanel api={fakeApi([cast()])} tierNames={["银", "金"]} notify={vi.fn()} failed={vi.fn()} />);
    await waitFor(() => expect(getByText("本周特惠")).toBeTruthy());
    expect(getByText("11 / 12")).toBeTruthy();
  });

  it("previews how many a segment reaches", async () => {
    const api = fakeApi([]);
    const { getByText } = render(<BroadcastsPanel api={api} tierNames={["金"]} notify={vi.fn()} failed={vi.fn()} />);
    await waitFor(() => expect(api.broadcasts).toHaveBeenCalled());
    fireEvent.click(getByText("金")); // pick a tier
    fireEvent.click(getByText("预览人数"));
    await waitFor(() => expect(api.previewSegment).toHaveBeenCalledWith(expect.objectContaining({ tiers: ["金"] })));
    await waitFor(() => expect(getByText(/可触达 12 人/)).toBeTruthy());
  });

  it("composes and sends a broadcast", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = fakeApi([]);
    const { getByText, getByLabelText } = render(<BroadcastsPanel api={api} tierNames={[]} notify={vi.fn()} failed={vi.fn()} />);
    await waitFor(() => expect(api.broadcasts).toHaveBeenCalled());
    fireEvent.change(getByLabelText("邮件标题"), { target: { value: "会员日 8 折" } });
    fireEvent.change(getByLabelText("邮件正文"), { target: { value: "本周五请来。" } });
    fireEvent.click(getByText("发送"));
    await waitFor(() => expect(api.createBroadcast).toHaveBeenCalledWith(expect.objectContaining({ subject: "会员日 8 折", body: "本周五请来。" })));
    await waitFor(() => expect(api.sendBroadcast).toHaveBeenCalledWith("b1"));
  });
});
