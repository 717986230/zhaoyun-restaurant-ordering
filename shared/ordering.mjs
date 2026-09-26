/**
 * Guests ordering from the menu on their phone: at the table (scanned the
 * table's card) or to pick up (外带自取). The order goes straight to the
 * kitchen printers, so what may be ordered is limited the way the QR-ordering
 * systems restaurants already run limit it:
 *
 *  - switched off until the owner switches it on, and only in the hours they set;
 *  - at a table, only once a waiter has opened it (开台) on the POS — a card
 *    photographed last week orders nothing — and not while its bill is being
 *    paid (the table lock);
 *  - an order is capped in items and in money;
 *  - one order per table (or per guest, for pickup) every so many seconds;
 *  - pickup needs a signed-in guest, with at most so many pickups still open.
 *
 * A table stays open until its bill is paid in full, until a waiter closes it,
 * or for `tableSessionHours` after it was opened (a table nobody paid for does
 * not take orders forever). A waiter's own POS order opens it too: the guests
 * are seated.
 *
 * Every refusal carries a code and an HTTP status, so both backends answer
 * alike and the menu can say what to do about it.
 */
import { isOnSchedule, normalizeSchedule } from "../src/schedule.js";
// Cycles (rules.mjs reads this module's settings rule): only function
// declarations cross them, and those exist before any module runs.
import { planOrder } from "./rules.mjs";
import { redeemPointsStatements, rewardPrices } from "./customer.mjs";
import { isTakeaway, TAKEAWAY_PREFIX } from "./pos.mjs";

export const GUEST_CHANNELS = ["dine-in", "pickup"];
export const GUEST_PAYMENTS = ["in-store", "online"];

export const GUEST_ORDERING_DEFAULTS = Object.freeze({
  enabled: false,
  dineIn: true,
  pickup: false,
  /** When guests may order, by the restaurant's clock; empty: whenever it is switched on. */
  hours: [],
  requireOpenTable: true,
  tableSessionHours: 4,
  maxItems: 30,
  maxOrderCents: 30_000,
  minIntervalSeconds: 60,
  maxOpenPickups: 2
});

const LIMITS = {
  tableSessionHours: [1, 24, "Open tables close after 1 to 24 hours"],
  maxItems: [1, 200, "Items per order is 1 to 200"],
  maxOrderCents: [100, 1_000_000, "The order limit is €1 to €10,000"],
  minIntervalSeconds: [0, 3600, "Seconds between orders is 0 to 3600"],
  maxOpenPickups: [1, 20, "Open pickups per guest is 1 to 20"]
};

export function normalizeGuestOrdering(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Ordering settings must be an object");
  const known = new Set(Object.keys(GUEST_ORDERING_DEFAULTS));
  for (const key of Object.keys(value)) if (!known.has(key)) throw new Error(`Unknown ordering setting ${key}`);
  const merged = { ...GUEST_ORDERING_DEFAULTS, ...value };
  for (const flag of ["enabled", "dineIn", "pickup", "requireOpenTable"]) {
    if (typeof merged[flag] !== "boolean") throw new Error(`${flag} must be true or false`);
  }
  const numbers = {};
  for (const [field, [min, max, message]] of Object.entries(LIMITS)) {
    const number = Number(merged[field]);
    if (!Number.isInteger(number) || number < min || number > max) throw new Error(message);
    numbers[field] = number;
  }
  if (!Array.isArray(merged.hours) || merged.hours.length > 7) throw new Error("At most 7 ordering hours");
  const hours = merged.hours.map((schedule) => {
    const normalized = normalizeSchedule(schedule);
    if (!normalized) throw new Error("Each ordering hour needs days and times");
    return normalized;
  });
  return { enabled: merged.enabled, dineIn: merged.dineIn, pickup: merged.pickup, hours, requireOpenTable: merged.requireOpenTable, ...numbers };
}

/** What the menu needs to know, served with the catalogue: nothing while it is off. */
export function orderingMenuView(ordering) {
  if (!ordering?.enabled || (!ordering.dineIn && !ordering.pickup)) return null;
  const { dineIn, pickup, hours, maxItems, maxOrderCents, requireOpenTable } = ordering;
  return { dineIn, pickup, hours, maxItems, maxOrderCents, requireOpenTable };
}

export function isOrderingOpen(ordering, at = new Date(), timeZone) {
  return !ordering.hours.length || ordering.hours.some((schedule) => isOnSchedule(schedule, at, timeZone));
}

export function guestOrderError(code, message, status, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

/**
 * Everything decided before the order is priced: may this guest order this
 * way, now. `context` is what the backend read:
 *  - `tableSession`: the table's open row (dine-in), or null;
 *  - `lastOrderAt`: when this table (dine-in) or this guest (pickup) last ordered, or null;
 *  - `openPickups`: this guest's pickups not yet paid;
 *  - `customer`: the signed-in guest, or null.
 */
export function assertGuestOrder({ ordering, timeZone, channel, customer, tableSession, lastOrderAt, openPickups = 0, payment = "in-store", at = new Date() }) {
  if (!ordering?.enabled) throw guestOrderError("ORDERING_OFF", "Ordering from the menu is not available; please ask a waiter", 403);
  if (!GUEST_CHANNELS.includes(channel)) throw guestOrderError("BAD_CHANNEL", "An order is for the table or for pickup", 400);
  if (channel === "dine-in" && !ordering.dineIn) throw guestOrderError("ORDERING_OFF", "Ordering at the table is not available; please ask a waiter", 403);
  if (channel === "pickup" && !ordering.pickup) throw guestOrderError("ORDERING_OFF", "Pickup orders are not available", 403);
  if (payment !== "in-store") throw guestOrderError("PAYMENT_UNAVAILABLE", "Online payment is not available yet; please pay in the restaurant", 400);
  if (!isOrderingOpen(ordering, at, timeZone)) throw guestOrderError("ORDERING_CLOSED", "We are not taking orders at this hour", 409);
  if (channel === "pickup" && !customer) throw guestOrderError("SIGN_IN_REQUIRED", "Sign in to order for pickup", 401);
  if (channel === "dine-in" && ordering.requireOpenTable && !(tableSession && tableSession.expires_at > at.toISOString())) {
    throw guestOrderError("TABLE_NOT_OPEN", "Your table is not open for ordering yet; please ask a waiter", 409);
  }
  if (channel === "pickup" && openPickups >= ordering.maxOpenPickups) {
    throw guestOrderError("TOO_MANY_PICKUPS", "You have pickups still waiting; please collect them first", 409);
  }
  if (lastOrderAt && ordering.minIntervalSeconds > 0) {
    const waited = (at.getTime() - Date.parse(lastOrderAt)) / 1000;
    if (waited < ordering.minIntervalSeconds) {
      const retryAfter = Math.max(1, Math.ceil(ordering.minIntervalSeconds - waited));
      throw guestOrderError("TOO_SOON", `Please wait ${retryAfter} seconds before the next order`, 429, { retryAfter });
    }
  }
}

/** What is decided once the order is priced (planOrder): its size. */
export function assertGuestOrderSize(plan, ordering) {
  const items = plan.items.reduce((sum, item) => sum + item.quantity, 0);
  if (items > ordering.maxItems) throw guestOrderError("ORDER_TOO_LARGE", `At most ${ordering.maxItems} items per order; please ask a waiter for more`, 400);
  if (plan.order.totalCents > ordering.maxOrderCents) {
    throw guestOrderError("ORDER_TOO_LARGE", `An order from the menu is at most €${(ordering.maxOrderCents / 100).toFixed(2)}; please ask a waiter`, 400);
  }
}

/** A table opened for ordering (开台), as the floor shows it. */
export function tableSessionView(row) {
  return row ? { table: row.table_no, openedAt: row.opened_at, expiresAt: row.expires_at, staffName: row.staff_name ?? null } : null;
}

export const TABLE_SESSION_SQL = "SELECT * FROM table_sessions WHERE table_no = ?";
export const LIVE_TABLE_SESSIONS_SQL = "SELECT * FROM table_sessions WHERE expires_at > ?";
/** Opens a table, or keeps it open longer. Parameters: table, at, expires, staff name. */
export const OPEN_TABLE_SESSION_SQL = `INSERT INTO table_sessions (table_no, opened_at, expires_at, staff_name) VALUES (?, ?, ?, ?)
  ON CONFLICT(table_no) DO UPDATE SET
    opened_at = CASE WHEN table_sessions.expires_at <= excluded.opened_at THEN excluded.opened_at ELSE table_sessions.opened_at END,
    expires_at = excluded.expires_at, staff_name = excluded.staff_name`;
export const CLOSE_TABLE_SESSION_SQL = "DELETE FROM table_sessions WHERE table_no = ?";
/** Run with the receipt: a table with nothing left open is closed for ordering. Parameters: table, table. */
export const CLOSE_PAID_TABLE_SESSION_SQL = `DELETE FROM table_sessions WHERE table_no = ?
  AND NOT EXISTS (SELECT 1 FROM orders WHERE orders.table_no = ? AND orders.billed_at IS NULL AND orders.status <> 'cancelled')`;

export const INSERT_GUEST_ORDER_SQL = `INSERT INTO guest_orders (order_id, customer_id, channel, table_no, pickup_no, payment, points_spent, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
export const LAST_TABLE_GUEST_ORDER_SQL = "SELECT MAX(created_at) AS at FROM guest_orders WHERE channel = 'dine-in' AND table_no = ?";
export const LAST_CUSTOMER_PICKUP_SQL = "SELECT MAX(created_at) AS at FROM guest_orders WHERE channel = 'pickup' AND customer_id = ?";
export const OPEN_PICKUPS_SQL = `SELECT COUNT(*) AS n FROM guest_orders JOIN orders ON orders.id = guest_orders.order_id
  WHERE guest_orders.customer_id = ? AND guest_orders.channel = 'pickup' AND orders.billed_at IS NULL AND orders.status NOT IN ('cancelled', 'completed')`;
/**
 * Today's next pickup number, shared with the POS's takeaways: past every
 * number an order has and every TA-n a POS holds open without one yet.
 * Parameters: since, since.
 */
export const NEXT_GUEST_PICKUP_SQL = `SELECT MAX(
    COALESCE((SELECT MAX(pickup_no) FROM order_staff WHERE pickup_no IS NOT NULL AND created_at >= ?), 0),
    COALESCE((SELECT MAX(CAST(SUBSTR(table_no, 4) AS INTEGER)) FROM table_claims WHERE table_no LIKE 'TA-%' AND expires_at > ?), 0)
  ) + 1 AS next`;

/** A guest's order as they follow it: the order, how it was placed and its pickup number. */
export const CUSTOMER_ORDERS_SQL = `SELECT orders.*, guest_orders.channel AS guest_channel, guest_orders.pickup_no AS pickup_no, guest_orders.points_spent AS points_spent
  FROM guest_orders JOIN orders ON orders.id = guest_orders.order_id
  WHERE guest_orders.customer_id = ? ORDER BY orders.created_at DESC LIMIT ?`;
/** The same for a guest without an account: their phone keeps the ids of its orders. */
export const GUEST_ORDERS_BY_REQUEST_SQL = `SELECT orders.*, guest_orders.channel AS guest_channel, guest_orders.pickup_no AS pickup_no, guest_orders.points_spent AS points_spent
  FROM guest_orders JOIN orders ON orders.id = guest_orders.order_id
  WHERE orders.client_request_id IN (?)`;
export const MAX_TRACKED_ORDERS = 20;

/** The start of today by the server's clock (UTC), for the day's pickup numbers. */
export function pickupDayStart(at = new Date()) {
  return `${at.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/**
 * A guest's order, planned: checked against the limits, priced by planOrder
 * with the guest's rewards, and the rows that come with it — the guest order
 * itself, a pickup's number, the points a reward spends — as [sql, params]
 * pairs for the backend's own transaction or batch.
 *
 * `guest` is { channel, customer, payment }; `reads` is what the backend read
 * for it (see assertGuestOrder), plus `nextPickupNo` for a pickup.
 */
export function planGuestOrder(input, productRows, settings, guest, reads, at = new Date()) {
  const ordering = settings.guestOrdering;
  const { customer, channel } = guest;
  const payment = guest.payment ?? "in-store";
  assertGuestOrder({ ordering, timeZone: settings.timeZone, channel, customer, payment, at, ...reads });
  const pickupNo = channel === "pickup" ? reads.nextPickupNo : null;
  const table = channel === "pickup" ? `${TAKEAWAY_PREFIX}${pickupNo}` : String(input.table ?? "");
  if (channel === "dine-in" && isTakeaway(table)) throw guestOrderError("BAD_CHANNEL", "Order for pickup instead", 400);
  const who = customer ? customer.name || customer.email.split("@")[0] : "";
  const plan = planOrder({ ...input, table }, productRows, { timeZone: settings.timeZone, setsSchedule: settings.setsSchedule, at }, {
    pickupNo,
    rewards: customer ? rewardPrices(settings.loyalty) : null,
    maxRewards: settings.loyalty?.maxRewardsPerOrder,
    guest: { channel, ...(who ? { name: who } : {}) }
  });
  assertGuestOrderSize(plan, ordering);
  if (plan.pointsSpent > (customer?.points ?? 0)) throw guestOrderError("NOT_ENOUGH_POINTS", "Not enough points for this reward", 409);
  const { id, timestamp } = plan.order;
  const statements = [
    [INSERT_GUEST_ORDER_SQL, [id, customer?.id ?? null, channel, table, pickupNo, payment, plan.pointsSpent, timestamp]],
    // The POS numbers its takeaways from order_staff; a guest's pickup takes its number there too.
    ...(pickupNo ? [["INSERT INTO order_staff (order_id, staff_id, staff_name, pickup_no, created_at) VALUES (?, ?, NULL, ?, ?)", [id, null, pickupNo, timestamp]]] : []),
    ...(customer ? redeemPointsStatements(id, customer.id, plan.pointsSpent, timestamp) : [])
  ];
  return { plan, pickupNo, statements, journal: { channel, pickupNo, pointsSpent: plan.pointsSpent } };
}

/** The table a waiter ordered at stays open for its guests' phones (a takeaway has no table to open). */
export function openTableStatements(table, settings, staffName, at = new Date()) {
  if (!table || isTakeaway(table)) return [];
  const hours = settings.guestOrdering?.tableSessionHours ?? GUEST_ORDERING_DEFAULTS.tableSessionHours;
  return [[OPEN_TABLE_SESSION_SQL, [String(table).toUpperCase(), at.toISOString(), new Date(at.getTime() + hours * 3_600_000).toISOString(), staffName ?? null]]];
}

/** A receipt paid the table off: closed for ordering until a waiter opens it again. */
export function closePaidTableStatements(table) {
  return table ? [[CLOSE_PAID_TABLE_SESSION_SQL, [String(table).toUpperCase(), String(table).toUpperCase()]]] : [];
}

/** The guests moved to another table: it is theirs to order from now, the old one is not. */
export function moveTableSessionStatements(from, to, settings, staffName, at = new Date()) {
  return [[CLOSE_TABLE_SESSION_SQL, [String(from).toUpperCase()]], ...openTableStatements(to, settings, staffName, at)];
}
