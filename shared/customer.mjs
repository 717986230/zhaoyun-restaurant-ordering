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
 *  - adjust:  the manager, by hand, with a note; and the booking membership's
 *             own lines (shared/reservations.mjs), told apart by their id:
 *             `welcome-<guest>` the first visit's bonus, once per account
 *             ever; `noshow-<booking>` a booking not kept; `noshowback-<booking>`
 *             that given back when the floor marks it kept after all;
 *             `signup-<guest>` signing up after scanning a table's code, once;
 *             `booking-<booking>` what a booking costs; `bookingback-<booking>`
 *             that given back when it is cancelled or declined.
 *
 * Both backends run these statements and these rules; only the way they
 * reach the database differs (shared/store.mjs, over each backend's driver).
 */
import { assertPassword } from "./auth.mjs";
import { checkMobile } from "./phone.mjs";

/** A guest stays signed in on their phone for a month. */
export const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const POINTS_REASONS = ["earn", "reverse", "redeem", "refund", "adjust"];

/**
 * The stored value a member keeps in the house (会员储值 / Guthaben). Its own
 * ledger (balance_ledger) and a balance (customers.balance_cents) written
 * together, the way points are, with a CHECK of its own (balance_cents >= 0)
 * so two bills spending the same balance at once cannot both succeed.
 *
 * In Austria a top-up is the sale of a multi-purpose voucher (Mehrzweck-
 * gutschein): the money is taken at 0% and no tax is due until it is spent on
 * food or drink — exactly as a value voucher (shared/register.mjs, planCheckout).
 * So a top-up is a receipt of its own with a 0% line, paid cash or card, and
 * `balance` is a way to pay a later bill, beside cash, card and voucher.
 *
 *  - topup:   the money a member puts in, on a top-up receipt;
 *  - bonus:   what the house adds on top (充值赠送), not paid for and not taxed;
 *  - spend:   a bill settled from the balance (a `balance` payment);
 *  - refund:  that bill cancelled (storno), the balance given back;
 *  - reverse: a top-up cancelled (storno), the money and bonus taken back;
 *  - adjust:  the manager, by hand, with a note.
 */
export const BALANCE_REASONS = ["topup", "bonus", "spend", "refund", "adjust", "reverse"];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 40;
const MAX_REWARDS = 30;
const MAX_POINTS = 1_000_000;
/** A single top-up is at most this much, as a value voucher is (shared/register.mjs). */
export const MAX_TOPUP_CENTS = 100_000;
/** A manager's hand-change of a balance is at most this much either way. */
const MAX_BALANCE_CENTS = 1_000_000;
/** At most this many top-up tiers, and a tier's bonus is at most a whole top-up. */
const MAX_TOPUP_TIERS = 20;

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
/**
 * How a guest signs in: an email, or a mobile number — checked to be one that
 * could be real (shared/phone.mjs), no code sent to it — kept as +E.164, so
 * "0660 1234567" and "+43 660 1234567" are the same account. The column is
 * still called email: an account by phone keeps its number there.
 */
export function normalizeLogin(value) {
  const raw = String(value ?? "").trim();
  if (raw.includes("@")) return normalizeEmail(raw);
  const mobile = checkMobile(raw);
  if (mobile.ok) return mobile.e164;
  const error = new Error(mobile.reason === "NOT_MOBILE" ? "Please give a mobile number, not a landline" : "Please enter an email address or a mobile number");
  error.code = mobile.reason === "NOT_MOBILE" ? "NOT_MOBILE" : "BAD_LOGIN";
  throw error;
}

/** Whether an account signs in by its mobile number (no email to send a code to). */
export function isPhoneLogin(login) {
  return Boolean(login) && !String(login).includes("@");
}

export function normalizeCustomerRegistration(input) {
  return { email: normalizeLogin(input?.email), name: normalizeCustomerName(input?.name), password: assertPassword(input?.password) };
}

/** A guest as they see themselves, and as the console lists them: never the hash. */
export function customerView(row) {
  return row ? {
    id: row.id, email: row.email, name: row.name, points: row.points, balanceCents: row.balance_cents ?? 0, createdAt: row.created_at,
    // Signed up with a mobile number: `email` is that number too, for the lists that show who it is.
    ...(isPhoneLogin(row.email) ? { phone: row.email } : {}),
    ...(row.email_verified !== undefined ? { emailVerified: Boolean(row.email_verified) } : {})
  } : null;
}

export function storedCustomerPassword(row) {
  return { hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations };
}

export function pointsEntryView(row) {
  const kind = pointsKind(row.id);
  return { id: row.id, delta: row.delta, reason: row.reason, ref: row.ref, note: row.note, createdAt: row.created_at, ...(kind ? { kind } : {}) };
}

/** Which of the booking membership's own lines a ledger line is, by its id; or null. */
export function pointsKind(id) {
  const value = String(id ?? "");
  if (value.startsWith("signup-")) return "signup";
  if (value.startsWith("bookingback-")) return "booking_back";
  if (value.startsWith("booking-")) return "booking";
  if (value.startsWith("welcome-")) return "welcome";
  if (value.startsWith("noshowback-")) return "no_show_back";
  if (value.startsWith("noshow-")) return "no_show";
  return null;
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

/**
 * The membership top-up programme as the owner sets it (app_settings
 * "membership"). Off until switched on. `tiers` give a bonus for a top-up of
 * at least so much (充 100 送 10): the most generous tier a top-up reaches is
 * the one that applies, so they are kept sorted and the amounts are whole
 * cents. The bonus is the house's gift, not money the member pays.
 */
export const MEMBERSHIP_DEFAULTS = Object.freeze({ enabled: false, tiers: [] });

export function normalizeMembership(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Membership settings must be an object");
  const known = new Set(Object.keys(MEMBERSHIP_DEFAULTS));
  for (const key of Object.keys(value)) if (!known.has(key)) throw new Error(`Unknown membership setting ${key}`);
  const merged = { ...MEMBERSHIP_DEFAULTS, ...value };
  if (typeof merged.enabled !== "boolean") throw new Error("Membership enabled must be true or false");
  if (!Array.isArray(merged.tiers) || merged.tiers.length > MAX_TOPUP_TIERS) throw new Error(`At most ${MAX_TOPUP_TIERS} top-up tiers`);
  const seen = new Set();
  const tiers = merged.tiers.map((tier) => {
    const thresholdCents = Number(tier?.thresholdCents);
    const bonusCents = Number(tier?.bonusCents);
    if (!Number.isInteger(thresholdCents) || thresholdCents < 1 || thresholdCents > MAX_TOPUP_CENTS) throw new Error("A tier's top-up is 1 cent to 1000 euros");
    if (!Number.isInteger(bonusCents) || bonusCents < 0 || bonusCents > MAX_TOPUP_CENTS) throw new Error("A tier's bonus is 0 to 1000 euros");
    if (seen.has(thresholdCents)) throw new Error("A top-up amount is a tier once");
    seen.add(thresholdCents);
    return { thresholdCents, bonusCents };
  }).sort((left, right) => left.thresholdCents - right.thresholdCents);
  return { enabled: merged.enabled, tiers };
}

/** The bonus a top-up of `amountCents` earns: the most generous tier it reaches, or none. */
export function bonusForTopUp(membership, amountCents) {
  if (!membership?.enabled || !Array.isArray(membership.tiers)) return 0;
  let bonus = 0;
  for (const tier of membership.tiers) if (amountCents >= tier.thresholdCents) bonus = tier.bonusCents;
  return bonus;
}

/** At most this many membership levels, and a level's name is at most this long. */
export const MAX_MEMBER_TIERS = 8;
const MAX_TIER_NAME = 40;

/**
 * 会员等级 (member levels) as the owner sets them (app_settings "memberTiers").
 * Off until switched on. A level is reached by累计充值 (lifetime top-up): the
 * member sits at the highest level whose threshold their top-ups have passed,
 * and that level's `discountPercent` is the 会员价 the counter offers them —
 * applied through the till's ordinary discount, so the fiscal record is
 * unchanged. The level is derived, never stored: it follows the top-ups.
 */
export const MEMBER_TIERS_DEFAULTS = Object.freeze({ enabled: false, tiers: [] });

export function normalizeMemberTiers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Member-tier settings must be an object");
  const known = new Set(Object.keys(MEMBER_TIERS_DEFAULTS));
  for (const key of Object.keys(value)) if (!known.has(key)) throw new Error(`Unknown member-tier setting ${key}`);
  const merged = { ...MEMBER_TIERS_DEFAULTS, ...value };
  if (typeof merged.enabled !== "boolean") throw new Error("Member tiers enabled must be true or false");
  if (!Array.isArray(merged.tiers) || merged.tiers.length > MAX_MEMBER_TIERS) throw new Error(`At most ${MAX_MEMBER_TIERS} member tiers`);
  const seen = new Set();
  const tiers = merged.tiers.map((tier) => {
    const name = String(tier?.name ?? "").trim();
    const thresholdCents = Number(tier?.thresholdCents);
    const discountPercent = Number(tier?.discountPercent);
    if (!name || name.length > MAX_TIER_NAME) throw new Error("A member tier has a name");
    if (!Number.isInteger(thresholdCents) || thresholdCents < 0 || thresholdCents > MAX_TOPUP_CENTS) throw new Error("A tier's threshold is 0 cent to 1000 euros");
    if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new Error("A tier's discount is 0 to 100 percent");
    if (seen.has(thresholdCents)) throw new Error("A threshold is a tier once");
    seen.add(thresholdCents);
    return { name, thresholdCents, discountPercent };
  }).sort((left, right) => left.thresholdCents - right.thresholdCents);
  return { enabled: merged.enabled, tiers };
}

/** The level a member of `growthCents` lifetime top-up sits at: the highest
 *  threshold they have passed, or null when tiers are off or none is reached. */
export function memberTierFor(growthCents, memberTiers) {
  if (!memberTiers?.enabled || !Array.isArray(memberTiers.tiers)) return null;
  let best = null;
  for (const tier of memberTiers.tiers) if (growthCents >= tier.thresholdCents && (!best || tier.thresholdCents >= best.thresholdCents)) best = tier;
  return best ? { name: best.name, thresholdCents: best.thresholdCents, discountPercent: best.discountPercent } : null;
}

/** A member's standing to show beside their account: how much they have topped
 *  up over time, their level now, and the discount that level earns. */
export function membershipStatus(growthCents, memberTiers) {
  const tier = memberTierFor(growthCents, memberTiers);
  return { growthCents: Math.max(0, growthCents | 0), tier: tier?.name ?? null, discountPercent: tier?.discountPercent ?? 0 };
}

/** A balance ledger line as a member sees it, and as the console lists it. */
export function balanceEntryView(row) {
  return { id: row.id, deltaCents: row.delta_cents, reason: row.reason, ref: row.ref, note: row.note, createdAt: row.created_at };
}

/** A manager's change of a member's balance: cents, not zero, and a note. */
export function normalizeBalanceAdjustment(input) {
  const deltaCents = Math.round(Number(input?.amount) * 100);
  if (!Number.isInteger(deltaCents) || deltaCents === 0 || Math.abs(deltaCents) > MAX_BALANCE_CENTS) throw new Error("A change of balance is an amount, not zero");
  const note = String(input?.note ?? "").trim().replace(/\s+/g, " ");
  if (!note || note.length > 120) throw new Error("Say why the balance changes (1–120 characters)");
  return { deltaCents, note };
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

/** Whether the account's address, as it is now, was proved by a code (shared/email-verify.mjs). */
const EMAIL_VERIFIED_COLUMN = `(SELECT 1 FROM customer_verified_emails AS verified
    WHERE verified.customer_id = customers.id AND verified.email = customers.email) AS email_verified`;
/** The member's stored value, read beside the account (shared/customer.mjs). Zero when they have no row yet. */
const BALANCE_COLUMN = `COALESCE((SELECT balance_cents FROM member_balances WHERE member_balances.customer_id = customers.id), 0) AS balance_cents`;
export const CUSTOMER_BY_EMAIL_SQL = `SELECT customers.*, ${EMAIL_VERIFIED_COLUMN}, ${BALANCE_COLUMN} FROM customers WHERE email = ?`;
export const CUSTOMER_BY_ID_SQL = `SELECT customers.*, ${EMAIL_VERIFIED_COLUMN}, ${BALANCE_COLUMN} FROM customers WHERE id = ?`;
export const INSERT_CUSTOMER_SQL = `INSERT INTO customers (id, email, name, password_hash, password_salt, password_iterations, points, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`;
export const UPDATE_CUSTOMER_SQL = "UPDATE customers SET name = ?, password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?";
/** A guest's account removed on request (GDPR): their orders stay the restaurant's, without them. */
export const DELETE_CUSTOMER_STATEMENTS = [
  "UPDATE guest_orders SET customer_id = NULL WHERE customer_id = ?",
  // Their bookings: the ones still to come cancelled, all of them without their name or number.
  `UPDATE reservations SET customer_id = NULL, name = '', phone = '', email = '', notes = '', token_hash = NULL,
     status = CASE WHEN status IN ('pending', 'confirmed') THEN 'cancelled' ELSE status END WHERE customer_id = ?`,
  "DELETE FROM points_ledger WHERE customer_id = ?",
  // Their balance goes with them (GDPR erasure): any money left is written off, not kept.
  "DELETE FROM balance_ledger WHERE customer_id = ?",
  "DELETE FROM member_balances WHERE customer_id = ?",
  "DELETE FROM customer_favorites WHERE customer_id = ?",
  "DELETE FROM customer_sessions WHERE customer_id = ?",
  "DELETE FROM email_codes WHERE customer_id = ?",
  "DELETE FROM customer_verified_emails WHERE customer_id = ?",
  "DELETE FROM customers WHERE id = ?"
];
/** The console's list: newest first, or those whose email or name holds the search. */
export const SEARCH_CUSTOMERS_SQL = `SELECT customers.*, ${BALANCE_COLUMN} FROM customers
  WHERE (? = '' OR email LIKE '%' || ? || '%' OR name LIKE '%' || ? || '%')
  ORDER BY created_at DESC LIMIT ?`;

export const INSERT_CUSTOMER_SESSION_SQL = "INSERT INTO customer_sessions (token_hash, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)";
export const CUSTOMER_SESSION_SQL = `SELECT customer_sessions.expires_at, customers.*, ${EMAIL_VERIFIED_COLUMN}, ${BALANCE_COLUMN}
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

export const BALANCE_HISTORY_SQL = "SELECT * FROM balance_ledger WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT ?";
/** 累计充值 (lifetime top-up principal): what a member has paid in over time, the basis for their 会员等级. Read-only. */
export const MEMBER_GROWTH_SQL = "SELECT COALESCE(SUM(delta_cents), 0) AS growth_cents FROM balance_ledger WHERE customer_id = ? AND reason = 'topup'";
export const INSERT_BALANCE_SQL = "INSERT INTO balance_ledger (id, customer_id, delta_cents, reason, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)";
/** A member's balance row, made the first time they have one (starts at zero). Parameters: customer id, at. */
export const ENSURE_BALANCE_SQL = "INSERT OR IGNORE INTO member_balances (customer_id, balance_cents, updated_at) VALUES (?, 0, ?)";
/**
 * Moves a member's balance by `delta`. Run after ENSURE_BALANCE_SQL in the
 * same batch, so the row is there. Fails the write (CHECK balance_cents >= 0)
 * when a spend or a take-back would leave less than nothing — a top-up
 * already spent cannot be reversed, and a bill cannot spend what is not there.
 * Parameters: delta, at, customer id.
 */
export const CHANGE_BALANCE_SQL = "UPDATE member_balances SET balance_cents = balance_cents + ?, updated_at = ? WHERE customer_id = ?";

/** Makes the member's row if need be, then moves it: the pair every balance change runs. */
export function changeBalanceStatements(memberId, delta, at) {
  return [
    [ENSURE_BALANCE_SQL, [memberId, at]],
    [CHANGE_BALANCE_SQL, [delta, at, memberId]]
  ];
}

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

/**
 * The ledger lines written just now (`at`) under `ref` whose id is like
 * `pattern`, added to each guest's balance. A line already there (INSERT OR
 * IGNORE kept the old one) is not counted again: its time is not `at`.
 * Parameters: applyNewParams.
 */
export const APPLY_NEW_POINTS_SQL = `UPDATE customers SET
  points = points + (SELECT SUM(delta) FROM points_ledger WHERE points_ledger.customer_id = customers.id AND points_ledger.id LIKE ? AND points_ledger.ref = ? AND points_ledger.created_at = ?),
  updated_at = ?
  WHERE id IN (SELECT customer_id FROM points_ledger WHERE id LIKE ? AND ref = ? AND created_at = ?)`;
export function applyNewParams(pattern, ref, at) {
  return [pattern, ref, at, at, pattern, ref, at];
}
/**
 * The first visit's bonus, for the signed-in guests whose orders a paid
 * receipt holds: once per account ever (the id is the guest's).
 * Parameters: points, receipt id, at, receipt id.
 */
export const WELCOME_POINTS_SQL = `INSERT OR IGNORE INTO points_ledger (id, customer_id, delta, reason, ref, note, created_at)
  SELECT DISTINCT 'welcome-' || guest_orders.customer_id, guest_orders.customer_id, ?, 'adjust', ?, '', ?
  FROM receipt_items
  JOIN order_items ON order_items.id = receipt_items.order_item_id
  JOIN guest_orders ON guest_orders.order_id = order_items.order_id
  WHERE receipt_items.receipt_id = ? AND guest_orders.customer_id IS NOT NULL`;
/** The same bonus given at the counter (the POS scanned the guest's member code). Parameters: id, customer id, points, at. */
export const WELCOME_AT_COUNTER_SQL = "INSERT OR IGNORE INTO points_ledger (id, customer_id, delta, reason, ref, note, created_at) VALUES (?, ?, ?, 'adjust', 'pos', '', ?)";
/**
 * A booking not kept: its guest loses the points, as many as they have —
 * never below zero — and once per booking, and only while it stands marked
 * so (the status is written first, in the same batch, and may have lost to
 * the floor). Parameters: points, at, booking id, points.
 */
export const NO_SHOW_POINTS_SQL = `INSERT OR IGNORE INTO points_ledger (id, customer_id, delta, reason, ref, note, created_at)
  SELECT 'noshow-' || reservations.id, reservations.customer_id, -MIN(?, customers.points), 'adjust', reservations.id, '', ?
  FROM reservations JOIN customers ON customers.id = reservations.customer_id
  WHERE reservations.id = ? AND reservations.status = 'no_show' AND MIN(?, customers.points) > 0`;
/** The floor marks it kept after all: what it took comes back, once. Parameters: at, booking id. */
export const NO_SHOW_BACK_SQL = `INSERT OR IGNORE INTO points_ledger (id, customer_id, delta, reason, ref, note, created_at)
  SELECT 'noshowback-' || ref, customer_id, -delta, 'adjust', ref, '', ?
  FROM points_ledger WHERE id = 'noshow-' || ?
    AND EXISTS (SELECT 1 FROM reservations WHERE reservations.id = points_ledger.ref AND reservations.status != 'no_show')`;

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

/** A receipt issued: the first-visit bonus for its guests who never had one. */
export function welcomePointsStatements(receiptId, points, at) {
  if (!points) return [];
  return [
    [WELCOME_POINTS_SQL, [points, receiptId, at, receiptId]],
    [APPLY_NEW_POINTS_SQL, applyNewParams("welcome-%", receiptId, at)]
  ];
}

/** The first-visit bonus at the counter, if the guest never had one. */
export function welcomeAtCounterStatements(customerId, points, at) {
  return [
    [WELCOME_AT_COUNTER_SQL, [`welcome-${customerId}`, customerId, points, at]],
    [APPLY_NEW_POINTS_SQL, applyNewParams(`welcome-${customerId}`, "pos", at)]
  ];
}

/** A booking marked not kept (by the floor, or gone past its time): its points taken. */
export function noShowPointsStatements(reservationId, points, at) {
  if (!points) return [];
  return [
    [NO_SHOW_POINTS_SQL, [points, at, reservationId, points]],
    [APPLY_NEW_POINTS_SQL, applyNewParams(`noshow-${reservationId}`, reservationId, at)]
  ];
}

/** Signed up after scanning a table's code: the bonus, once per account. */
export function signupPointsStatements(customerId, points, at) {
  if (!points) return [];
  return [
    ["INSERT OR IGNORE INTO points_ledger (id, customer_id, delta, reason, ref, note, created_at) VALUES (?, ?, ?, 'adjust', 'signup', '', ?)", [`signup-${customerId}`, customerId, points, at]],
    [APPLY_NEW_POINTS_SQL, applyNewParams(`signup-${customerId}`, "signup", at)]
  ];
}

/** A booking made: what it costs, taken — or the whole batch refused (CHECK points >= 0). */
export function bookingPointsStatements(reservationId, customerId, points, at) {
  if (!points) return [];
  return [
    [INSERT_POINTS_SQL, [`booking-${reservationId}`, customerId, -points, "adjust", reservationId, "", at]],
    [CHANGE_POINTS_SQL, [-points, at, customerId]]
  ];
}

/** A booking cancelled or declined before it was kept: what it cost, given back, once. */
export function bookingBackStatements(reservationId, at) {
  return [
    ["INSERT OR IGNORE INTO points_ledger (id, customer_id, delta, reason, ref, note, created_at) SELECT 'bookingback-' || ref, customer_id, -delta, 'adjust', ref, '', ? FROM points_ledger WHERE id = 'booking-' || ? AND EXISTS (SELECT 1 FROM reservations WHERE reservations.id = points_ledger.ref AND reservations.status IN ('cancelled', 'declined'))", [at, reservationId]],
    [APPLY_NEW_POINTS_SQL, applyNewParams(`bookingback-${reservationId}`, reservationId, at)]
  ];
}

/** A booking taken back from not kept: its points given back. */
export function noShowBackStatements(reservationId, at) {
  return [
    [NO_SHOW_BACK_SQL, [at, reservationId]],
    [APPLY_NEW_POINTS_SQL, applyNewParams(`noshowback-${reservationId}`, reservationId, at)]
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

// ——— Stored value: what a top-up, a bill or a storno adds to its own batch.

/** A top-up receipt: the money in, and the house's bonus on top, added to the member's balance. */
export function topUpBalanceStatements(memberId, principalCents, bonusCents, receiptId, at) {
  const statements = [
    [INSERT_BALANCE_SQL, [`topup-${receiptId}`, memberId, principalCents, "topup", receiptId, "", at]],
    ...changeBalanceStatements(memberId, principalCents, at)
  ];
  if (bonusCents) statements.push(
    [INSERT_BALANCE_SQL, [`bonus-${receiptId}`, memberId, bonusCents, "bonus", receiptId, "", at]],
    ...changeBalanceStatements(memberId, bonusCents, at)
  );
  return statements;
}

/** A bill settled from balances: each member's share taken, or the batch refused (CHECK >= 0). */
export function spendBalanceStatements(receiptId, debits, at) {
  return debits.flatMap((debit, index) => [
    [INSERT_BALANCE_SQL, [`spend-${receiptId}-${index}`, debit.memberId, -debit.amountCents, "spend", receiptId, "", at]],
    ...changeBalanceStatements(debit.memberId, -debit.amountCents, at)
  ]);
}

/** That bill cancelled: each member's share given back. */
export function refundBalanceStatements(stornoId, refunds, at) {
  return refunds.flatMap((refund, index) => [
    [INSERT_BALANCE_SQL, [`refund-${stornoId}-${index}`, refund.memberId, refund.amountCents, "refund", stornoId, "", at]],
    ...changeBalanceStatements(refund.memberId, refund.amountCents, at)
  ]);
}

/** A top-up cancelled: the money and its bonus taken back, or the batch refused if already spent. */
export function reverseBalanceStatements(stornoId, reversals, at) {
  return reversals.flatMap((reversal, index) => [
    [INSERT_BALANCE_SQL, [`reverse-${stornoId}-${index}`, reversal.memberId, -reversal.amountCents, "reverse", stornoId, "", at]],
    ...changeBalanceStatements(reversal.memberId, -reversal.amountCents, at)
  ]);
}
