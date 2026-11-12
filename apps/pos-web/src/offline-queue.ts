/**
 * 离线发单队列 — the POS's outbox.
 *
 * When "Send" cannot reach the server (the restaurant's Wi-Fi dropped, the
 * phone walked out of range), the order must not be lost. It is stored here,
 * in this device's localStorage, and sent again on its own once the device is
 * back online. Every order carries the same `clientRequestId` it was first
 * given, and the server keys new orders on that id (a UNIQUE index on
 * `client_request_id`, see shared/store.mjs `createOrder`), so re-sending one
 * that actually landed returns the existing order rather than firing it twice.
 *
 * The functions are pure over a Storage-like object so the flush logic can be
 * tested without a browser.
 */

import { ApiError } from "@zhaoyun/api-client";
import type { CreateOrderCommand } from "@zhaoyun/contracts";

export interface QueuedOrder extends CreateOrderCommand {
  /** Portions in the order, so a toast and the badge can say how many wait. */
  count: number;
  /** When it first failed to send, epoch ms — oldest goes out first. */
  queuedAt: number;
}

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;

export const OUTBOX_KEY = "zy_pos_outbox";

function isQueuedOrder(value: unknown): value is QueuedOrder {
  if (!value || typeof value !== "object") return false;
  const order = value as Partial<QueuedOrder>;
  return typeof order.clientRequestId === "string"
    && typeof order.table === "string"
    && Array.isArray(order.items);
}

/** Every order still waiting to go out, oldest first. A damaged store reads empty. */
export function readOutbox(store: Reader): QueuedOrder[] {
  try {
    const raw: unknown = JSON.parse(store.getItem(OUTBOX_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter(isQueuedOrder) : [];
  } catch {
    return [];
  }
}

function writeOutbox(store: Writer, list: QueuedOrder[]): void {
  // Best effort: a full or blocked store leaves the order only in memory, which
  // is no worse than before this queue existed.
  try { store.setItem(OUTBOX_KEY, JSON.stringify(list)); } catch { /* not kept */ }
}

/** Puts an order at the back of the queue; the same clientRequestId never doubles up. */
export function enqueue(store: Reader & Writer, order: QueuedOrder): QueuedOrder[] {
  const list = readOutbox(store).filter((queued) => queued.clientRequestId !== order.clientRequestId);
  list.push(order);
  writeOutbox(store, list);
  return list;
}

/** Drops one order once it has landed (or been settled for good). */
export function resolve(store: Reader & Writer, clientRequestId: string): QueuedOrder[] {
  const list = readOutbox(store).filter((queued) => queued.clientRequestId !== clientRequestId);
  writeOutbox(store, list);
  return list;
}

/**
 * A failure the queue should keep an order for and try again later, rather
 * than drop it: the device never reached the server at all (fetch threw, not
 * an ApiError), or the server answered with a state that may pass next time —
 * the waiter's session timed out (401), the request timed out (408), the rate
 * limit bit (429), or the server itself erred (5xx).
 */
export function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 401 || error.status === 408 || error.status === 429 || error.status >= 500;
}

export type FlushOutcome =
  | { kind: "sent"; order: QueuedOrder }
  | { kind: "dropped"; order: QueuedOrder; reason: string }
  | { kind: "blocked" };

/**
 * Sends every queued order in turn. A sent (or already-landed) order leaves the
 * queue; a definite rejection from the server leaves it too, reported so the
 * waiter knows, rather than looping on it forever; the first transient failure
 * stops the run and keeps the rest for next time.
 */
export async function flushOutbox(
  store: Reader & Writer,
  send: (command: CreateOrderCommand) => Promise<unknown>,
  report: (outcome: FlushOutcome) => void,
): Promise<void> {
  for (const order of readOutbox(store)) {
    try {
      await send({ clientRequestId: order.clientRequestId, table: order.table, note: order.note, items: order.items });
      resolve(store, order.clientRequestId);
      report({ kind: "sent", order });
    } catch (error) {
      if (isTransient(error)) { report({ kind: "blocked" }); return; }
      resolve(store, order.clientRequestId);
      report({ kind: "dropped", order, reason: error instanceof Error ? error.message : String(error) });
    }
  }
}
