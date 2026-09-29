/**
 * The cash drawer (Kassenlade / 钱箱), with no database attached: a shift
 * opens with the float counted in (备用金), money put in or taken out between
 * sales is written down with why (Einlage / Entnahme: change fetched from the
 * bank, vegetables paid from the till), and at the end the drawer is counted
 * (Kassensturz / 点钞): what should be in it against what is.
 *
 * What should be in it: the float, the cash the receipts took since the
 * drawer was opened (a storno's cash going back out), what was put in, less
 * what was taken out, less the card tips — those came in on the restaurant's
 * terminal and are the staff's, paid out of the till (a waiter settling keeps
 * them back of the cash they hand in; shared/pos.mjs). Cash tips never go
 * into the drawer: the staff keep them.
 *
 * One drawer for the restaurant: one open at a time.
 */

import { closingTotals } from "./register.mjs";
import { parseJson, uuid } from "./core.mjs";

/** Euro notes and coins, in cents, largest first: the count is by these. */
export const DENOMINATIONS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
/** More than this in a small restaurant's drawer is a typing slip. */
export const MAX_DRAWER_CENTS = 2_000_000;
export const MOVEMENT_KINDS = ["in", "out"];

function amountCents(value, what, { zero = false } = {}) {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents) || cents < 0 || (!zero && cents === 0)) throw new Error(`${what} must be ${zero ? "zero or more" : "more than zero"}`);
  if (cents > MAX_DRAWER_CENTS) throw new Error(`${what} is at most ${MAX_DRAWER_CENTS / 100} euros`);
  return cents;
}

/**
 * What was counted: either note by note and coin by coin (`counts`, cents of
 * the denomination → how many), which is what the drawer's report keeps, or
 * the sum alone (`amount`, euros).
 */
export function countedOf(input) {
  if (input?.counts && typeof input.counts === "object") {
    const counts = {};
    let cents = 0;
    for (const [key, value] of Object.entries(input.counts)) {
      const denomination = Number(key);
      const count = Number(value);
      if (!DENOMINATIONS.includes(denomination)) throw new Error(`There is no ${denomination / 100} euro note or coin`);
      if (!Number.isInteger(count) || count < 0 || count > 10_000) throw new Error("A count is a whole number");
      if (count) counts[denomination] = count;
      cents += denomination * count;
    }
    if (cents > MAX_DRAWER_CENTS) throw new Error(`The count is at most ${MAX_DRAWER_CENTS / 100} euros`);
    return { cents, counts };
  }
  return { cents: amountCents(input?.amount, "The count", { zero: true }), counts: null };
}

export function floatOf(input) {
  return amountCents(input?.float ?? 0, "The float", { zero: true });
}

/** Money put in or taken out, with why: nothing leaves the drawer unexplained. */
export function movementOf(input) {
  const kind = String(input?.kind ?? "");
  if (!MOVEMENT_KINDS.includes(kind)) throw new Error("Money is put in or taken out");
  const reason = String(input?.reason ?? "").trim().slice(0, 120);
  if (!reason) throw new Error("Say what the money is for");
  return { kind, amountCents: amountCents(input?.amount, "The amount"), reason };
}

/**
 * The drawer's figures. `receiptRows` are the receipts since it was opened
 * (DRAWER_RECEIPTS_SQL), `movementRows` its movements. With `countedCents`,
 * the difference too: over when positive, short when negative.
 */
export function drawerTotals(session, receiptRows, movementRows, countedCents = null) {
  const takings = closingTotals(receiptRows);
  const inCents = movementRows.filter((row) => row.kind === "in").reduce((sum, row) => sum + row.amount_cents, 0);
  const outCents = movementRows.filter((row) => row.kind === "out").reduce((sum, row) => sum + row.amount_cents, 0);
  const expectedCents = session.float_cents + takings.payments.cash + inCents - outCents - takings.tips.card;
  return {
    floatCents: session.float_cents,
    receipts: receiptRows.length,
    firstReceiptNo: takings.firstReceiptNo,
    lastReceiptNo: takings.lastReceiptNo,
    cashSalesCents: takings.payments.cash,
    cardTipsCents: takings.tips.card,
    cashTipsCents: takings.tips.cash,
    inCents,
    outCents,
    expectedCents,
    ...(countedCents === null ? {} : { countedCents, differenceCents: countedCents - expectedCents })
  };
}

export function movementView(row) {
  return { id: row.id, kind: row.kind, amountCents: row.amount_cents, reason: row.reason, staffName: row.staff_name ?? null, createdAt: row.created_at };
}

/** An open drawer as the POS shows it: its figures so far and what went in and out. */
export function drawerView(row, totals, movementRows) {
  if (!row) return null;
  const closed = Boolean(row.closed_at);
  return {
    id: row.id,
    open: !closed,
    openedAt: row.opened_at,
    openedBy: row.opened_by ?? null,
    closedAt: row.closed_at ?? null,
    closedBy: row.closed_by ?? null,
    note: row.note ?? null,
    counts: parseJson(row.counts_json, null),
    totals: closed ? parseJson(row.totals_json, totals) : totals,
    movements: movementRows.map(movementView)
  };
}

/** A drawer, and the one before it: its receipts start after the last receipt when it opened. */
export const DRAWER_RECEIPTS_SQL = "SELECT * FROM receipts WHERE receipt_no > ? ORDER BY receipt_no";
export const OPEN_DRAWER_SQL = "SELECT * FROM drawer_sessions WHERE open_flag = 1";
export const DRAWER_MOVEMENTS_SQL = "SELECT * FROM drawer_movements WHERE session_id = ? ORDER BY created_at, id";
/** open_flag is UNIQUE: a second open drawer is refused by the database, even from two devices at once. */
export const INSERT_DRAWER_SQL = `INSERT INTO drawer_sessions (id, open_flag, after_receipt_no, float_cents, opened_by, opened_at)
  VALUES (?, 1, COALESCE((SELECT MAX(receipt_no) FROM receipts), 0), ?, ?, ?)`;
export const INSERT_MOVEMENT_SQL = `INSERT INTO drawer_movements (id, session_id, kind, amount_cents, reason, staff_id, staff_name, created_at)
  SELECT ?, id, ?, ?, ?, ?, ?, ? FROM drawer_sessions WHERE id = ? AND open_flag = 1`;
export const CLOSE_DRAWER_SQL = `UPDATE drawer_sessions SET open_flag = NULL, closed_at = ?, closed_by = ?, last_receipt_no = ?, counted_cents = ?, counts_json = ?, totals_json = ?, note = ?
  WHERE id = ? AND open_flag = 1`;

/** The rows a new movement writes. */
export function planMovement(session, input, { staff = null, at }) {
  const movement = movementOf(input);
  return { id: uuid(), sessionId: session.id, ...movement, staffId: staff?.id ?? null, staffName: staff?.name ?? null, at };
}

/** What goes to the front printer when a drawer is counted. */
export function drawerPrintPayload(view, company) {
  return { kind: "drawer", company, drawer: view };
}
