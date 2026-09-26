/**
 * The POS the floor works with (apps/pos-web), with no database attached:
 * the devices it runs on, the waiters who sign in to it, which device has a
 * table open, takeaway orders, and each waiter's settlement at the end of a
 * shift. Both backends call these and only read and write the rows.
 *
 * How a restaurant's POS works, the way Orderman and the Austrian systems do:
 * - A device is paired once, by the manager, and from then on is the only
 *   kind of thing a waiter's PIN works on. Four digits are a fine way to
 *   tell waiters apart and a poor way to keep strangers out, so the internet
 *   never gets to try them: no paired device, no PIN.
 * - A waiter signs in with their PIN; what they order and take in is theirs,
 *   and at the end of the shift they hand in the cash their receipts add up
 *   to (Kellnerabrechnung).
 * - A table open on one device is locked for the others until it is closed
 *   or left alone for a while (Tischsperre): two waiters adding to or paying
 *   the same bill at once is how a bill ends up wrong.
 * - A takeaway order is a table of its own, TA-<pickup number>, so ordering,
 *   the kitchen, the bill and paying work for it exactly as for a table.
 */

import { now, parseJson } from "./rules.mjs";
import { closingTotals } from "./register.mjs";

export const STAFF_ROLES = ["staff", "manager"];
/** How long a table stays locked to a device that stopped touching it. */
export const CLAIM_TTL_MS = 90_000;
export const POS_SESSION_TTL_MS = 14 * 60 * 60 * 1000;
export const TAKEAWAY_PREFIX = "TA-";

export function normalizeStaffInput(input, current = null) {
  const name = String(input.name ?? current?.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 32) throw new Error("A waiter's name is 1 to 32 characters");
  const role = String(input.role ?? current?.role ?? "staff");
  if (!STAFF_ROLES.includes(role)) throw new Error("A waiter is staff or manager");
  const pin = input.pin === undefined || input.pin === "" ? null : String(input.pin);
  if (pin !== null && !/^\d{4,6}$/.test(pin)) throw new Error("A PIN is 4 to 6 digits");
  if (!current && pin === null) throw new Error("A new waiter needs a PIN");
  const active = input.active === undefined ? (current ? Boolean(current.active) : true) : Boolean(input.active);
  return { name, role, pin, active };
}

export function staffView(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, role: row.role, active: Boolean(row.active) };
}

export function deviceView(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, createdAt: row.created_at, lastSeenAt: row.last_seen_at };
}

export function normalizeDeviceName(value) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 32) throw new Error("A device's name is 1 to 32 characters");
  return name;
}

export function isTakeaway(table) {
  return String(table ?? "").toUpperCase().startsWith(TAKEAWAY_PREFIX);
}

/**
 * Takes a table for a device, or renews its hold. A table held by another
 * device and not left alone past CLAIM_TTL_MS stays theirs: the row the
 * upsert leaves behind says who has it, and the caller compares.
 */
export const CLAIM_UPSERT_SQL = `INSERT INTO table_claims (table_no, device_id, staff_id, staff_name, expires_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(table_no) DO UPDATE SET device_id = excluded.device_id, staff_id = excluded.staff_id,
    staff_name = excluded.staff_name, expires_at = excluded.expires_at
  WHERE table_claims.device_id = excluded.device_id OR table_claims.expires_at <= ?`;

export function claimView(row, at = now()) {
  if (!row || row.expires_at <= at) return null;
  return { table: row.table_no, deviceId: row.device_id, staffId: row.staff_id, staffName: row.staff_name, expiresAt: row.expires_at };
}

/** Whether this device already has the table open: keeping it is not news. */
export function holdsClaim(row, deviceId, at = now()) {
  return Boolean(row && row.device_id === deviceId && row.expires_at > at);
}

/** Throws when another device has the table open. */
export function assertClaim(row, deviceId, at = now()) {
  const claim = claimView(row, at);
  if (claim && claim.deviceId !== deviceId) {
    const error = new Error(`Table ${claim.table} is open on another device (${claim.staffName})`);
    error.code = "TABLE_CLAIMED";
    error.claim = claim;
    throw error;
  }
}

/**
 * A waiter's settlement: the receipts they took since their last one — how
 * much in cash they hand in, by card, by voucher, the sales and stornos.
 */
/** A waiter's receipts since their last settlement, and the dishes they voided (OPEN_STAFF_VOIDS_SQL). */
export function settlementTotals(rows, voidRows = []) {
  const totals = closingTotals(rows);
  return { ...totals, receipts: rows.length, voids: { count: voidRows.length, cents: voidRows.reduce((sum, row) => sum + row.amount_cents, 0) } };
}

export function settlementView(row) {
  if (!row) return null;
  return {
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    totals: parseJson(row.totals_json, {}),
    createdAt: row.created_at
  };
}

/** The receipts a waiter took since their last settlement. */
export const OPEN_STAFF_RECEIPTS_SQL = `SELECT * FROM receipts WHERE staff_id = ?
  AND receipt_no > COALESCE((SELECT MAX(last_receipt_no) FROM staff_settlements WHERE staff_id = ?), 0) ORDER BY receipt_no`;

/** Sold out (沽清) or back on: a published dish only. Guests' menus drop it at once (catalog.changed). */
export const SET_AVAILABLE_SQL = "UPDATE products SET available = ?, updated_at = ? WHERE id = ? AND published = 1";

/** The dishes a waiter voided since their last settlement. */
export const OPEN_STAFF_VOIDS_SQL = `SELECT * FROM order_item_voids WHERE staff_id = ?
  AND created_at > COALESCE((SELECT MAX(created_at) FROM staff_settlements WHERE staff_id = ?), '') ORDER BY created_at`;

/** Who is signed in on which device right now. */
export const LIVE_POS_SESSIONS_SQL = `SELECT pos_sessions.staff_id, pos_devices.name AS device_name
  FROM pos_sessions JOIN pos_devices ON pos_devices.id = pos_sessions.device_id
  WHERE pos_sessions.expires_at > ? ORDER BY pos_devices.name`;

/**
 * Each waiter as the manager watches the floor: signed in or not and where,
 * the tables they have open, and their shift so far — what they took since
 * their last settlement, the cash they hold included.
 * `sessions` are LIVE_POS_SESSIONS_SQL rows, `claims` claimView objects,
 * `shifts` each waiter's settlementTotals by id.
 */
export function staffActivityView(staffRows, sessions, claims, shifts) {
  return staffRows.filter((row) => row.active).map((row) => {
    const devices = sessions.filter((session) => session.staff_id === row.id).map((session) => session.device_name);
    return {
      ...staffView(row),
      online: devices.length > 0,
      devices: [...new Set(devices)],
      tables: claims.filter((claim) => claim.staffId === row.id).map((claim) => claim.table).sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
      shift: shifts.get(row.id)
    };
  });
}

/** The next takeaway number today, by the restaurant's clock. */
export const NEXT_PICKUP_SQL = `SELECT COALESCE(MAX(pickup_no), 0) + 1 AS next FROM order_staff WHERE pickup_no IS NOT NULL AND created_at >= ?`;
