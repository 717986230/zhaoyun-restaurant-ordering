/**
 * The guests' own accounts: an email and a password, the dishes they keep as
 * favourites, and the points they collect (积分) and spend on rewards.
 *
 * Nothing here is the restaurant's account (shared/account.mjs): a guest's
 * session opens no door of the console or the POS. It travels in its own
 * header, `x-customer-token`, and only the /api/customer routes and the
 * guest's order read it.
 *
 * Points are a ledger (points_ledger) and a balance (customers.points) written
 * together, in one transaction or one D1 batch. The balance has a CHECK of
 * its own (points >= 0), so two orders spending the same points at once
 * cannot both succeed: the second write fails whole, on either backend.
 *
 *  - earn:    a paid receipt, for the lines of a signed-in guest's orders
 *             (pointsPerEuro of the dish prices, rewards count nothing);
 *  - reverse: that receipt cancelled (storno), as much as is left to take;
 *  - redeem:  a reward in an order, the moment it is ordered;
 *  - refund:  that order cancelled before anything of it was paid;
 *  - adjust:  the manager, by hand, with a note.
 *
 * Both backends run these statements and these rules; only the way they
 * reach the database differs (server/database.mjs, workers/store.mjs).
 */
import { assertPassword } from "./rules.mjs";

/** A guest stays signed in on their phone for a month. */
export const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const POINTS_REASONS = ["earn", "reverse", "redeem", "refund", "adjust"];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 40;
const MAX_REWARDS = 30;
const MAX_POINTS = 1_000_000;

/** An email, compared without case. */
export function normalizeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new Error("Please enter a valid email address");
  return email;
}

export function normalizeCustomerName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
}

/** Everything a registration needs, checked before anything is written. */
export function normalizeCustomerRegistration(input) {
  return { email: normalizeEmail(input?.email), name: normalizeCustomerName(input?.name), password: assertPassword(input?.password) };
}

/** A guest as they see themselves, and as the console lists them: never the hash. */
export function customerView(row) {
  return row ? { id: row.id, email: row.email, name: row.name, points: row.points, createdAt: row.created_at } : null;
}

export function storedCustomerPassword(row) {
  return { hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations };
}

export function pointsEntryView(row) {
  return { id: row.id, delta: row.delta, reason: row.reason, ref: row.ref, note: row.note, createdAt: row.created_at };
}

/**
 * The points programme as the owner sets it (app_settings "loyalty"). Off
 * until switched on. `rewards` are dishes (or anything on the menu — a bottle,
 * a mug) and what each costs in points; a reward is ordered like a dish and
 * costs nothing but its points and any priced options.
 */
export const LOYALTY_DEFAULTS = Object.freeze({ enabled: false, pointsPerEuro: 1, rewards: [], maxRewardsPerOrder: 1 });

export function normalizeLoyalty(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Loyalty settings must be an object");
  const known = new Set(Object.keys(LOYALTY_DEFAULTS));
  for (const key of Object.keys(value)) if (!known.has(key)) throw new Error(`Unknown loyalty setting ${key}`);
  const merged = { ...LOYALTY_DEFAULTS, ...value };
  if (typeof merged.enabled !== "boolean") throw new Error("Loyalty enabled must be true or false");
  const pointsPerEuro = Number(merged.pointsPerEuro);
  if (!Number.isInteger(pointsPerEuro) || pointsPerEuro < 0 || pointsPerEuro > 100) throw new Error("Points per euro is a whole number from 0 to 100");
  const maxRewardsPerOrder = Number(merged.maxRewardsPerOrder);
  if (!Number.isInteger(maxRewardsPerOrder) || maxRewardsPerOrder < 1 || maxRewardsPerOrder > 10) throw new Error("Rewards per order is 1 to 10");
  if (!Array.isArray(merged.rewards) || merged.rewards.length > MAX_REWARDS) throw new Error(`At most ${MAX_REWARDS} rewards`);
  const seen = new Set();
  const rewards = merged.rewards.map((reward) => {
    const productId = String(reward?.productId ?? "").trim();
    const points = Number(reward?.points);
    if (!productId || productId.length > 128) throw new Error("A reward names a dish");
    if (seen.has(productId)) throw new Error("A dish is a reward once");
    if (!Number.isInteger(points) || points < 1 || points > 100_000) throw new Error("A reward costs 1 to 100000 points");
    seen.add(productId);
    return { productId, points };
  });
  return { enabled: merged.enabled, pointsPerEuro, rewards, maxRewardsPerOrder };
}

/** The rewards a guest may order now: dish id → points, or null when the programme is off. */
export function rewardPrices(loyalty) {
  return loyalty?.enabled ? new Map(loyalty.rewards.map((reward) => [reward.productId, reward.points])) : null;
}

/** A manager's change of a guest's points: a whole number, not zero, and a note. */
export function normalizePointsAdjustment(input) {
  const delta = Number(input?.delta);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_POINTS) throw new Error("A change of points is a whole number, not zero");
  const note = String(input?.note ?? "").trim().replace(/\s+/g, " ");
  if (!note || note.length > 120) throw new Error("Say why the points change (1–120 characters)");
  return { delta, note };
}

/** The balance cannot go below zero (CHECK): a write that would is refused whole. */
export function isOverdrawn(error) {
  return /CHECK constraint failed/i.test(String(error?.message ?? error));
}

export const CUSTOMER_BY_EMAIL_SQL = "SELECT * FROM customers WHERE email = ?";
export const CUSTOMER_BY_ID_SQL = "SELECT * FROM customers WHERE id = ?";
export const INSERT_CUSTOMER_SQL = `INSERT INTO customers (id, email, name, password_hash, password_salt, password_iterations, points, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`;
export const UPDATE_CUSTOMER_SQL = "UPDATE customers SET name = ?, password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?";
/** A guest's account removed on request (GDPR): their orders stay the restaurant's, without them. */
export const DELETE_CUSTOMER_STATEMENTS = [
  "UPDATE guest_orders SET customer_id = NULL WHERE customer_id = ?",
  "DELETE FROM points_ledger WHERE customer_id = ?",
  "DELETE FROM customer_favorites WHERE customer_id = ?",
  "DELETE FROM customer_sessions WHERE customer_id = ?",
  "DELETE FROM customers WHERE id = ?"
];
/** The console's list: newest first, or those whose email or name holds the search. */
export const SEARCH_CUSTOMERS_SQL = `SELECT * FROM customers
  WHERE (? = '' OR email LIKE '%' || ? || '%' OR name LIKE '%' || ? || '%')
  ORDER BY created_at DESC LIMIT ?`;

export const INSERT_CUSTOMER_SESSION_SQL = "INSERT INTO customer_sessions (token_hash, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)";
export const CUSTOMER_SESSION_SQL = `SELECT customer_sessions.expires_at, customers.*
  FROM customer_sessions JOIN customers ON customers.id = customer_sessions.customer_id
  WHERE customer_sessions.token_hash = ?`;
export const DELETE_CUSTOMER_SESSION_SQL = "DELETE FROM customer_sessions WHERE token_hash = ?";
export const DELETE_CUSTOMER_SESSIONS_SQL = "DELETE FROM customer_sessions WHERE customer_id = ?";
export const DELETE_EXPIRED_CUSTOMER_SESSIONS_SQL = "DELETE FROM customer_sessions WHERE expires_at <= ?";

export const FAVORITES_SQL = "SELECT product_id FROM customer_favorites WHERE customer_id = ? ORDER BY created_at";
export const ADD_FAVORITE_SQL = "INSERT OR IGNORE INTO customer_favorites (customer_id, product_id, created_at) VALUES (?, ?, ?)";
export const REMOVE_FAVORITE_SQL = "DELETE FROM customer_favorites WHERE customer_id = ? AND product_id = ?";
export const MAX_FAVORITES = 200;

export const POINTS_HISTORY_SQL = "SELECT * FROM points_ledger WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT ?";
export const INSERT_POINTS_SQL = "INSERT INTO points_ledger (id, customer_id, delta, reason, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)";
/** Fails the write (CHECK points >= 0) when the guest has fewer points than it takes. */
export const CHANGE_POINTS_SQL = "UPDATE customers SET points = points + ?, updated_at = ? WHERE id = ?";

/**
 * Points for a paid receipt, run after its receipt_items in the same
 * transaction or batch: per signed-in guest whose order lines it paid, the
 * dish prices of those lines × pointsPerEuro, whole points, rounded down.
 * Parameters: pointsPerEuro, at, receipt id, pointsPerEuro.
 */
export const EARN_POINTS_SQL = `INSERT INTO points_ledger (id, customer_id, delta, reason, ref, note, created_at)
  SELECT 'earn-' || receipt_items.receipt_id || '-' || guest_orders.customer_id, guest_orders.customer_id,
    CAST(SUM(receipt_items.quantity * order_items.unit_price_cents) * ? / 100 AS INTEGER), 'earn', receipt_items.receipt_id, '', ?
  FROM receipt_items
  JOIN order_items ON order_items.id = receipt_items.order_item_id
  JOIN guest_orders ON guest_orders.order_id = order_items.order_id
  WHERE receipt_items.receipt_id = ? AND guest_orders.customer_id IS NOT NULL
  GROUP BY guest_orders.customer_id
  HAVING CAST(SUM(receipt_items.quantity * order_items.unit_price_cents) * ? / 100 AS INTEGER) > 0`;
/** The ledger lines of one kind for one receipt or order, added to each guest's balance (applyPointsParams). */
export const APPLY_POINTS_SQL = `UPDATE customers SET
  points = points + (SELECT SUM(delta) FROM points_ledger WHERE points_ledger.customer_id = customers.id AND points_ledger.ref = ? AND points_ledger.reason = ?),
  updated_at = ?
  WHERE id IN (SELECT customer_id FROM points_ledger WHERE ref = ? AND reason = ?)`;
/**
 * A receipt cancelled: what it earned is taken back, as far as the guest still
 * has it — points already spent on a reward are not clawed below zero.
 * Parameters: storno id, storno id, original id, at, original id.
 */
export const REVERSE_POINTS_SQL = `INSERT INTO points_ledger (id, customer_id, delta, reason, ref, note, created_at)
  SELECT 'reverse-' || ? || '-' || earned.customer_id, earned.customer_id, -MIN(earned.delta, customers.points), 'reverse', ?, ?, ?
  FROM points_ledger AS earned JOIN customers ON customers.id = earned.customer_id
  WHERE earned.ref = ? AND earned.reason = 'earn' AND MIN(earned.delta, customers.points) > 0`;
/**
 * An order with a reward cancelled: its points come back, once — the refund's
 * id is the order's. Parameters: order id, at, order id.
 */
export const REFUND_POINTS_SQL = `INSERT OR IGNORE INTO points_ledger (id, customer_id, delta, reason, ref, note, created_at)
  SELECT 'refund-' || ref, customer_id, -delta, 'refund', ref, '', ?
  FROM points_ledger WHERE ref = ? AND reason = 'redeem'`;

/** `APPLY_POINTS_SQL`'s parameters, in its order. */
export function applyPointsParams(ref, reason, at) {
  return [ref, reason, at, ref, reason];
}

// What an order, a receipt or a storno adds to its own transaction or batch,
// as [sql, params] pairs each backend runs its own way.

/** A reward ordered: its points spent, or the whole order refused (CHECK). */
export function redeemPointsStatements(orderId, customerId, points, at) {
  if (!points) return [];
  return [
    [INSERT_POINTS_SQL, [`redeem-${orderId}`, customerId, -points, "redeem", orderId, "", at]],
    [CHANGE_POINTS_SQL, [-points, at, customerId]]
  ];
}

/** A receipt issued: the points its guests earned, while the programme is on. */
export function earnPointsStatements(receiptId, loyalty, at) {
  if (!loyalty?.enabled || !loyalty.pointsPerEuro) return [];
  return [
    [EARN_POINTS_SQL, [loyalty.pointsPerEuro, at, receiptId, loyalty.pointsPerEuro]],
    [APPLY_POINTS_SQL, applyPointsParams(receiptId, "earn", at)]
  ];
}

/** A receipt cancelled: what it earned, taken back. Whether or not the programme is still on. */
export function reversePointsStatements(stornoId, originalId, at) {
  return [
    [REVERSE_POINTS_SQL, [stornoId, stornoId, originalId, at, originalId]],
    [APPLY_POINTS_SQL, applyPointsParams(stornoId, "reverse", at)]
  ];
}

/** An order cancelled: the points its rewards took, given back. */
export function refundPointsStatements(orderId, at) {
  return [
    [REFUND_POINTS_SQL, [at, orderId]],
    [APPLY_POINTS_SQL, applyPointsParams(orderId, "refund", at)]
  ];
}
