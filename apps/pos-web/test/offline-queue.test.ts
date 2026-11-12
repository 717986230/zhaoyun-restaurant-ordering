import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@zhaoyun/api-client";
import type { CreateOrderCommand } from "@zhaoyun/contracts";
import { enqueue, flushOutbox, OUTBOX_KEY, readOutbox, resolve } from "../src/offline-queue";
import type { FlushOutcome, QueuedOrder } from "../src/offline-queue";

/** A localStorage stand-in for the queue to read and write. */
function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

const order = (id: string, table = "T-1", count = 2): QueuedOrder => ({
  clientRequestId: id, table, note: "", count, queuedAt: 1, items: [{ id: "dish", qty: count }],
});

describe("the POS offline outbox", () => {
  it("keeps queued orders oldest-first and never doubles up one clientRequestId", () => {
    const store = fakeStore();
    enqueue(store, order("a"));
    enqueue(store, order("b"));
    enqueue(store, order("a", "T-9", 5)); // same id again: replaces, stays one entry
    const queue = readOutbox(store);
    expect(queue.map((q) => q.clientRequestId)).toEqual(["b", "a"]);
    expect(queue.find((q) => q.clientRequestId === "a")?.table).toBe("T-9");
  });

  it("reads an empty queue from a missing or damaged store", () => {
    expect(readOutbox(fakeStore())).toEqual([]);
    expect(readOutbox(fakeStore({ [OUTBOX_KEY]: "not json" }))).toEqual([]);
    expect(readOutbox(fakeStore({ [OUTBOX_KEY]: '[{"table":"T-1"}]' }))).toEqual([]); // no id/items
  });

  it("drops one order once it has landed", () => {
    const store = fakeStore();
    enqueue(store, order("a"));
    enqueue(store, order("b"));
    resolve(store, "a");
    expect(readOutbox(store).map((q) => q.clientRequestId)).toEqual(["b"]);
  });

  it("sends every queued order and empties itself", async () => {
    const store = fakeStore();
    enqueue(store, order("a"));
    enqueue(store, order("b"));
    const send = vi.fn(async (_command: CreateOrderCommand) => ({ order: {} }));
    const outcomes: FlushOutcome[] = [];
    await flushOutbox(store, send, (o) => outcomes.push(o));
    expect(send).toHaveBeenCalledTimes(2);
    expect(readOutbox(store)).toEqual([]);
    expect(outcomes.map((o) => o.kind)).toEqual(["sent", "sent"]);
  });

  it("stops and keeps the queue when the device is still offline", async () => {
    const store = fakeStore();
    enqueue(store, order("a"));
    enqueue(store, order("b"));
    // fetch throwing a TypeError is not an ApiError: the server was never reached.
    const send = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const outcomes: FlushOutcome[] = [];
    await flushOutbox(store, send, (o) => outcomes.push(o));
    expect(send).toHaveBeenCalledTimes(1); // stopped after the first failure
    expect(readOutbox(store).map((q) => q.clientRequestId)).toEqual(["a", "b"]);
    expect(outcomes).toEqual([{ kind: "blocked" }]);
  });

  it("keeps the queue on a transient server answer (session timeout, rate limit, 5xx)", async () => {
    for (const status of [401, 429, 503]) {
      const store = fakeStore();
      enqueue(store, order("a"));
      const send = vi.fn(async () => { throw new ApiError("nope", status); });
      const outcomes: FlushOutcome[] = [];
      await flushOutbox(store, send, (o) => outcomes.push(o));
      expect(readOutbox(store)).toHaveLength(1);
      expect(outcomes).toEqual([{ kind: "blocked" }]);
    }
  });

  it("drops an order the server definitively rejected, so it cannot loop forever", async () => {
    const store = fakeStore();
    enqueue(store, order("a"));
    enqueue(store, order("b"));
    const send = vi.fn(async (command: CreateOrderCommand) => {
      if (command.clientRequestId === "a") throw new ApiError("Unknown table", 403);
      return { order: {} };
    });
    const outcomes: FlushOutcome[] = [];
    await flushOutbox(store, send, (o) => outcomes.push(o));
    expect(readOutbox(store)).toEqual([]); // "a" dropped, "b" sent
    expect(outcomes[0]).toMatchObject({ kind: "dropped", reason: "Unknown table" });
    expect(outcomes[1]).toMatchObject({ kind: "sent" });
  });
});
