import type { ApiMenuSettings } from "@zhaoyun/contracts";
import { isOnSchedule } from "../../../../src/schedule.js";

/**
 * What this guest may order, and how, right now: the owner's switch and
 * hours (shared/ordering.mjs, served with the catalogue) against the
 * restaurant's clock, and whether this phone scanned a table. The server
 * decides again on every order — a table not opened by a waiter, a pause
 * between orders — and says why when it refuses.
 */
export interface OrderingState {
  /** Switched on, and within the hours. */
  open: boolean;
  /** Switched on, but not at this hour. */
  closed: boolean;
  /** The table this phone scanned, when guests may order at the table. */
  table: string | null;
  pickup: boolean;
  maxItems: number;
  maxOrderCents: number;
}

export const ORDERING_OFF: OrderingState = { open: false, closed: false, table: null, pickup: false, maxItems: 0, maxOrderCents: 0 };

export function orderingState(menu: ApiMenuSettings | undefined, table: string | null, at: Date, timeZone: string): OrderingState {
  const ordering = menu?.ordering;
  if (!ordering) return ORDERING_OFF;
  const table_ = ordering.dineIn ? table : null;
  const channels = Boolean(table_) || ordering.pickup;
  const inHours = !ordering.hours.length || ordering.hours.some((schedule) => isOnSchedule(schedule, at, timeZone));
  return {
    open: channels && inHours,
    closed: channels && !inHours,
    table: table_,
    pickup: ordering.pickup,
    maxItems: ordering.maxItems,
    maxOrderCents: ordering.maxOrderCents
  };
}

/** An id for an order the guest is placing; kept across retries, so a retry never orders twice. */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
